import type { H3Event } from 'h3';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import * as authSchema from '~~/server/db/schema/auth';
import { seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Graphics Authoring Lease as its stored row: what a heartbeat keeps, when a lapsed
// lease frees its artifact, and that it never gates a read. Only the clock, Ably and
// the Session are faked; the commit-time fence is `screenGraphicsAuthoringLease.sqlite.test.ts`'s.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: { params: unknown }, parse: (value: unknown) => unknown) => parse(event.params));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

// The lease names its holder through the auth tables, as the real `~~/server/db` does.
vi.doMock('~~/server/db', () => ({
	db,
	schema: {
		...schema,
		...authSchema,
	},
}));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

/** The Session the next request is made with, as the API boundary would have admitted it. */
let askingSessionId = 'session-holder';
vi.doMock('~~/server/utils/auth', () => ({
	requireUserId: async () => 'user-1',
	requireBrowserSessionId: async () => askingSessionId,
	optionalBrowserSessionId: async () => askingSessionId,
}));

const { graphicsAuthoringLeaseModule } = await import('~~/server/modules/graphics-authoring-lease');
const { screenEditWorkspaceLeaseRef } = await import('~~/server/modules/graphics-authoring-lease/screenEditWorkspace');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const readScreen = (await import('~~/server/api/events/[id]/screens/[screenId]/index.get')).default as unknown as (event: H3Event) => Promise<{
	modeConfigs: { 'broadcast-graphics': { graphics: BroadcastGraphicConfig[] } };
}>;

const HOLDER = 'session-holder';
const OTHER = 'session-other';
const GRANTED_AT = Date.UTC(2026, 0, 1, 12);

let eventId: number;
let screenId: number;

function ask(sessionId: string, heartbeatIntervalMs?: number) {
	return graphicsAuthoringLeaseModule().acquire({
		...screenEditWorkspaceLeaseRef(eventId, screenId),
		sessionId,
		heartbeatIntervalMs,
	});
}

/** The one row the artifact's lease is, as `[holder, acquiredAt, expiresAt]`. */
async function storedLease() {
	const rows = await db.select().from(schema.graphicsAuthoringLeases);
	return rows
		.filter(row => row.artifactId === String(screenId))
		.map(row => [
			row.holderSessionId,
			row.acquiredAt.getTime(),
			row.expiresAt.getTime(),
		]);
}

beforeEach(async () => {
	// Only the clock a deadline is stamped and judged on; libSQL keeps its real timers.
	vi.useFakeTimers({
		toFake: ['Date'],
	});
	vi.setSystemTime(GRANTED_AT);
	askingSessionId = HOLDER;
	const seeded = await seedBroadcastGraphicsScreen(db, {
		stack: { graphics: [] },
	});
	eventId = seeded.eventId;
	screenId = seeded.screenId;
});

afterEach(() => {
	vi.useRealTimers();
});

afterAll(async () => await harness.close());

describe('a Graphics Authoring Lease heartbeat', () => {
	it('moves the holder\'s deadline on by the time that passed, keeping when it was first held', async () => {
		const granted = await ask(HOLDER);
		vi.setSystemTime(GRANTED_AT + 5_000);

		const renewed = await ask(HOLDER);

		expect(renewed.outcome).toBe('renew');
		expect(renewed.lease).toMatchObject({
			role: 'holder',
			writable: true,
			heldSince: GRANTED_AT,
			expiresAt: granted.lease.expiresAt! + 5_000,
		});
		expect(await storedLease()).toEqual([
			[HOLDER, GRANTED_AT, granted.lease.expiresAt! + 5_000],
		]);
	});
});

describe('a Graphics Authoring Lease whose holder stopped asking', () => {
	// Both sides of the deadline: live until the instant before it, absent from it on.
	it.each([
		{
			when: 'the instant before its deadline',
			early: 1,
			outcome: 'observe',
			lease: { role: 'observer', writable: false, heldByAnotherSession: true },
			holder: HOLDER,
		},
		{
			when: 'at its deadline',
			early: 0,
			outcome: 'grant',
			lease: { role: 'holder', writable: true, heldByAnotherSession: false },
			holder: OTHER,
		},
	])('answers the next Session with $outcome $when', async ({ early, outcome, lease, holder }) => {
		const granted = await ask(HOLDER, 1_000);
		vi.setSystemTime(granted.lease.expiresAt! - early);

		const asked = await ask(OTHER);

		expect(asked.outcome).toBe(outcome);
		expect(asked.lease).toMatchObject(lease);
		expect((await storedLease()).map(([stored]) => stored)).toEqual([holder]);
	});
});

describe('a Screen read while its Edit workspace is leased', () => {
	it('answers an observing Session the holder\'s accepted stack', async () => {
		await ask(HOLDER);
		await screenWriteModule().updateModeConfig({
			eventId,
			screenId,
			mode: 'broadcast-graphics',
			config: {
				graphics: [
					{ id: 'holder-stack', name: 'Holder stack', items: [] },
					{ id: 'second-graphic', name: 'Second graphic', items: [] },
				],
			},
			stateVersion: 0,
			graphicsAssets: () => ({}) as never,
			authoringSessionId: HOLDER,
		});
		askingSessionId = OTHER;
		expect((await ask(OTHER)).lease.writable).toBe(false);

		const screen = await readScreen(stubH3Event({
			params: {
				id: String(eventId),
				screenId: String(screenId),
			},
		}));

		expect(screen.modeConfigs['broadcast-graphics'].graphics.map(entry => entry.id))
			.toEqual(['holder-stack', 'second-graphic']);
	});
});
