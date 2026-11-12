import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// POST /api/events/:id/screens/:screenId/command over real SQL: a command goes to the
// Screen's own channel, only for a Screen of that Event, and the 200 means it was
// delivered. Only Ably is faked; how a refusal is named and logged is `ably.test.ts`'s.

interface StubRequest { params: Record<string, string>; body: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);

type Handler = (event: H3Event) => Promise<unknown>;
const postCommand = (await import('~~/server/api/events/[id]/screens/[screenId]/command.post')).default as unknown as Handler;

let eventId: number;
let screenId: number;
/** A Screen of another Event. */
let foreignScreenId: number;

async function stageEventWithScreen(name: string) {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId: event!.id,
			name: 'Programme',
			slug: 'programme',
			currentMode: 'standings',
			assetCapabilitySeed: `seed-${name}`,
			assetCapabilityDigest: `digest-${name}`,
		})
		.returning({ id: schema.screens.id });
	return { eventId: event!.id, screenId: screen!.id };
}

function post(commandedScreenId: number, body: unknown = { command: 'refresh' }) {
	return postCommand(stubH3Event({
		params: {
			id: String(eventId),
			screenId: String(commandedScreenId),
		},
		body,
	}));
}

beforeAll(async () => {
	({ eventId, screenId } = await stageEventWithScreen('commanded'));
	({ screenId: foreignScreenId } = await stageEventWithScreen('foreign'));
});
beforeEach(() => ably.reset());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => await harness.close());

describe('commanding a Screen', () => {
	it('sends the command to the Screen\'s own channel and answers once it is delivered', async () => {
		await expect(post(screenId)).resolves.toEqual({ ok: true });

		expect(ably.published).toEqual([
			{
				channel: screenRealtimeChannel(eventId, screenId),
				type: 'screen:command:refresh',
				payload: { screenId },
			},
		]);
	});

	it.each([
		[
			'a Screen that does not exist',
			() => 999_999,
		],
		[
			'a Screen of another Event',
			() => foreignScreenId,
		],
	])('answers 404 to a command for %s, sending nothing', async (_screen, commanded) => {
		await expect(post(commanded())).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

		expect(ably.published).toEqual([]);
	});

	// The publish is the route's whole effect, so a swallowed refusal would promise a delivery that never happened.
	it('lets a refused publish out, because the 200 means the command was delivered', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		ably.refuse(screenRealtimeChannel(eventId, screenId));

		await expect(post(screenId)).rejects.toMatchObject({
			name: 'RealtimePublishError',
			statusCode: 502,
			message: 'Realtime publish failed',
		});

		expect(ably.published).toEqual([]);
	});
});
