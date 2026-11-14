import type { H3Event } from 'h3';
import type { FeatureMatchSessionCommandResult, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { ClockState } from '~~/shared/types/featureMatchState';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Session's clock is stored in the shape it always was, whatever the app holds
// inside: one stored before this read correctly, and a command stores that shape.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseHeader', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

vi.doMock('~~/server/db', () => ({ db }));
const published: Array<{ type: string; data: { currentState: { clock: ClockState } } }> = [];
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async (_eventId: number, type: string, data: { currentState: { clock: ClockState } }) => {
		published.push({ type, data });
	},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

const readPublic = (await import('~~/server/api/public/events/[id]/feature-match-slots/[slotId].get')).default as unknown as (event: H3Event) => Promise<Array<{ clock: string }>>;
const sendCommand = (await import('~~/server/api/events/[id]/feature-match-sessions/[sessionId]/commands.post')).default as unknown as (event: H3Event) => Promise<FeatureMatchSessionCommandResult>;

const NOW = Date.UTC(2026, 9, 29, 12);
const PLAYER = {
	name: 'Alice',
	wins: 0,
	losses: 0,
	draws: 0,
};

/** A ten-minute countdown that counts up after, as a Session stored it before the count-up limit existed. */
const STORED_BEFORE_THE_LIMIT = {
	type: 'countdown',
	durationMs: 600_000,
	elapsedMs: 30_000,
	isRunning: false,
	lastStartedAt: null,
	countUpAfterCountdown: true,
} satisfies ClockState;

beforeEach(() => {
	published.length = 0;
	vi.useFakeTimers({
		toFake: ['Date'],
		now: NOW,
	});
});
afterEach(() => vi.useRealTimers());
afterAll(async () => await harness.close());

/** A Slot whose active Session holds `clock` exactly as given. */
async function stage(clock: ClockState) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Regional Championship', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [slot] = await db.insert(schema.featureMatchSlots)
		.values({ eventId, player1Data: PLAYER, player2Data: PLAYER })
		.returning({ id: schema.featureMatchSlots.id });
	const slotId = slot!.id;
	const [session] = await db.insert(schema.featureMatchSessions)
		.values({
			eventId,
			slotId,
			sourceSnapshot: {
				playerDisplayMode: 'score',
				player1: { playerId: null, data: PLAYER },
				player2: { playerId: null, data: PLAYER },
			} as FeatureMatchSourceSnapshot,
			currentState: {
				...createInitialFeatureMatchState(),
				clock,
			},
		})
		.returning({ id: schema.featureMatchSessions.id, sequence: schema.featureMatchSessions.sequence });
	await db.update(schema.featureMatchSlots)
		.set({ activeSessionId: session!.id })
		.where(eq(schema.featureMatchSlots.id, slotId));

	const storedClock = async () => (await db.query.featureMatchSessions.findFirst({
		where: eq(schema.featureMatchSessions.id, session!.id),
	}))!.currentState.clock;

	return {
		shown: async () => (await readPublic(stubH3Event({
			params: {
				id: String(eventId),
				slotId: String(slotId),
			},
		})))[0]!.clock,
		send: (type: string) => sendCommand(stubH3Event({
			params: {
				id: String(eventId),
				sessionId: String(session!.id),
			},
			body: {
				commandId: `${type}-${session!.id}`,
				baseSequence: session!.sequence,
				type,
				payload: {},
			},
		})),
		storedClock,
	};
}

describe('a Feature Match Session clock stored in today\'s shape', () => {
	it.each<{ name: string; clock: ClockState; shown: string }>([
		{
			name: 'one running past its end, stored before the count-up limit, counting up without limit',
			clock: { ...STORED_BEFORE_THE_LIMIT, isRunning: true, lastStartedAt: NOW - 6_000_000 },
			shown: '1:30:30',
		},
		{
			name: 'one stored running with no start as stopped at its stored time',
			clock: { ...STORED_BEFORE_THE_LIMIT, isRunning: true, lastStartedAt: null },
			shown: '9:30',
		},
		{
			name: 'one stored stopped with a start as stopped at its stored time',
			clock: { ...STORED_BEFORE_THE_LIMIT, lastStartedAt: NOW - 90_000 },
			shown: '9:30',
		},
	])('reads $name', async ({ clock, shown }) => {
		const session = await stage(clock);

		await expect(session.shown()).resolves.toBe(shown);
		// Reading stores nothing: the row is as it was written.
		await expect(session.storedClock()).resolves.toStrictEqual(clock);
	});

	it('stores, answers and announces a clock command in the field set it was stored with', async () => {
		const session = await stage({ ...STORED_BEFORE_THE_LIMIT, isRunning: true, lastStartedAt: NOW - 90_000 });

		const result = await session.send('PauseClock');

		const paused = {
			type: 'countdown',
			durationMs: 600_000,
			elapsedMs: 120_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: true,
			countUpLimitMs: null,
		};
		await expect(session.storedClock()).resolves.toStrictEqual(paused);
		expect(result.currentState.clock).toStrictEqual(paused);
		expect(published.map(message => message.data.currentState.clock)).toStrictEqual([paused]);
		await expect(session.shown()).resolves.toBe('8:00');
	});
});
