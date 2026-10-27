import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Live Results is an operator setting beside Melee Sync: on only while sync is on,
// turning it on starts a fresh poll, turning it off touches nothing else.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn();
interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage,
	publishMessageStrict: vi.fn(),
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));

const { default: handler } = await import('~~/server/api/events/[id]/melee/live-results.put');

afterAll(async () => await harness.close());

const now = new Date('2026-10-27T12:00:00.000Z');
const earlier = new Date('2026-10-27T00:00:00.000Z');

/** Live Results as it stood after stopping itself: off, idle, mid-backoff. */
const stoppedPoll = {
	meleeLiveResultsEnabled: false,
	meleeLiveResultsNextCheckAt: earlier,
	meleeLiveResultsBackoffStep: 3,
	meleeLiveResultsLastCheckedAt: earlier,
	meleeLiveResultsLastChangeAt: earlier,
	meleeLiveResultsError: 'Melee.gg is unavailable',
	meleeLiveResultsStopReason: 'idle' as const,
};

async function stageEvent(values: Partial<typeof schema.events.$inferInsert>) {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		...values,
	}).returning({ id: schema.events.id });
	return event!.id;
}

async function storedPoll(eventId: number) {
	const event = (await db.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	}))!;
	return {
		meleeLiveResultsEnabled: event.meleeLiveResultsEnabled,
		meleeLiveResultsNextCheckAt: event.meleeLiveResultsNextCheckAt,
		meleeLiveResultsBackoffStep: event.meleeLiveResultsBackoffStep,
		meleeLiveResultsLastCheckedAt: event.meleeLiveResultsLastCheckedAt,
		meleeLiveResultsLastChangeAt: event.meleeLiveResultsLastChangeAt,
		meleeLiveResultsError: event.meleeLiveResultsError,
		meleeLiveResultsStopReason: event.meleeLiveResultsStopReason,
	};
}

async function put(eventId: number, enabled: boolean) {
	return await handler({
		params: {
			id: String(eventId),
		},
		body: { enabled },
	} as never);
}

beforeEach(() => {
	publishMessage.mockClear();
	vi.useFakeTimers({
		toFake: ['Date'],
	});
	vi.setSystemTime(now);
});

afterEach(() => vi.useRealTimers());

describe('pUT /api/events/:id/melee/live-results', () => {
	it('refuses to turn Live Results on while Melee Sync is off', async () => {
		const eventId = await stageEvent({ meleeEnabled: false, ...stoppedPoll });

		await expect(put(eventId, true)).rejects.toMatchObject({
			statusCode: 400,
			data: { code: 'MELEE_SYNC_DISABLED' },
		});
		expect(await storedPoll(eventId)).toEqual(stoppedPoll);
		expect(publishMessage).not.toHaveBeenCalled();
	});

	it.each([
		{
			case: 'on starts a fresh poll, as if a change just happened',
			enabled: true,
			expected: {
				meleeLiveResultsEnabled: true,
				meleeLiveResultsNextCheckAt: null,
				meleeLiveResultsBackoffStep: 0,
				meleeLiveResultsLastCheckedAt: earlier,
				meleeLiveResultsLastChangeAt: now,
				meleeLiveResultsError: null,
				meleeLiveResultsStopReason: null,
			},
		},
		{
			case: 'off touches nothing else',
			enabled: false,
			expected: stoppedPoll,
		},
	])('turning Live Results $case, and announces the Event', async ({ enabled, expected }) => {
		const eventId = await stageEvent({ meleeEnabled: true, ...stoppedPoll, meleeLiveResultsEnabled: !enabled });

		const response = await put(eventId, enabled);

		expect(await storedPoll(eventId)).toEqual(expected);
		expect(response).toMatchObject({ id: eventId, meleeLiveResultsEnabled: enabled });
		expect(publishMessage).toHaveBeenCalledWith(
			eventId,
			'event:updated',
			{
				event: expect.objectContaining({ meleeLiveResultsEnabled: enabled }),
			},
			'origin-1',
		);
	});
});
