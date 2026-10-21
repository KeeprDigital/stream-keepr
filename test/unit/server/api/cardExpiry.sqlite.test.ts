import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Who changes a timed Card's durable state when it expires, today (#707).
 *
 * Characterisation, not specification: these pin what main does so the ADR-0022
 * revision #707 proposes has evidence under it. Rows that revision changes say
 * so in their names (a read that clears, the operator's expiry DELETE, the raw
 * Screen read); the follow-up implementing it rewrites those rows to its
 * acceptance scenarios rather than deleting them. The Card
 * routes run as written over real SQLite (the version guard is SQL). Only
 * admission and transport are stood in for: every announcement is recorded
 * instead of sent, and the Screen Output read is admitted without a capability.
 *
 * What a row here observes, and why each is observed where it is:
 * - **durable state and revision** are the Screen row's `activeCard` and
 *   `activeCardVersion`. No route answers the version, and it is the guard the
 *   read-time cleanup relies on, so it is read from the row.
 * - **announcements** are the realtime messages the server published.
 * - **the derived copy** is the KV key the service mirrors the Card into.
 */

const harness = await createSqliteD1Harness();
const realDb = drizzle(harness.database, { schema });

/**
 * Runs once, between the Card read loading its row and deciding what to do with it,
 * so a test can place a concurrent write exactly there.
 */
let afterCardRowLoaded: (() => Promise<void>) | null = null;
const db = new Proxy(realDb, {
	get(target, property) {
		if (property === 'query') {
			return {
				...target.query,
				screens: {
					...target.query.screens,
					findFirst: async (...args: Parameters<typeof target.query.screens.findFirst>) => {
						const row = await target.query.screens.findFirst(...args);
						// The Card read's own load names the revision it will guard on; the route's existence check does not.
						const hook = args[0]?.columns?.activeCardVersion ? afterCardRowLoaded : null;
						if (hook) {
							afterCardRowLoaded = null;
							await hook();
						}
						return row;
					},
				},
			};
		}
		const value = Reflect.get(target, property, target);
		return typeof value === 'function' ? value.bind(target) : value;
	},
});
vi.doMock('~~/server/db', () => ({ db }));

const published: Array<{ type: string; data: Record<string, unknown> }> = [];
async function publishMessage(_eventId: number, type: string, data: Record<string, unknown>) {
	published.push({ type, data });
}
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	getOriginConnectionId: () => undefined,
}));
vi.stubGlobal('publishMessage', publishMessage);

const kv = new Map<string, unknown>();
vi.stubGlobal('useStorage', () => ({
	set: async (key: string, value: unknown) => void kv.set(key, value),
	del: async (key: string) => void kv.delete(key),
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

// Admission is ADR-0022's and pinned elsewhere; this suite is about what the read does once admitted.
async function admitScreenOutputRead(event: StubEvent) {
	const eventId = Number(event.params.id);
	const screen = await realDb.query.screens.findFirst({ where: eq(schema.screens.id, Number(event.params.screenId)) });
	return { eventId, screen, reader: 'capability' };
}
vi.doMock('~~/server/utils/screenOutputRead', () => ({
	requireScreenOutputRead: admitScreenOutputRead,
	requireScreenOutputModeRead: admitScreenOutputRead,
}));

type Handler = (event: H3Event) => Promise<unknown>;
const putCard = (await import('~~/server/api/events/[id]/screens/[screenId]/card/index.put')).default as unknown as Handler;
const getCard = (await import('~~/server/api/events/[id]/screens/[screenId]/card/index.get')).default as unknown as Handler;
const deleteCard = (await import('~~/server/api/events/[id]/screens/[screenId]/card/index.delete')).default as unknown as Handler;
const getOutputCard = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/card.get')).default as unknown as Handler;
const getOutputScreen = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/index.get')).default as unknown as Handler;

let eventId: number;
let screenId: number;
const SAVED_AT = Date.UTC(2026, 9, 21, 12, 0, 0);

function request(body?: unknown): H3Event {
	return stubH3Event({ params: { id: String(eventId), screenId: String(screenId) }, body });
}

function card(id: string, timeoutDuration?: number) {
	return {
		id,
		name: id,
		set: 'lea',
		layout: 'normal',
		imageData: { front: null, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
		...(timeoutDuration === undefined ? {} : { timeoutData: { timeoutDuration, timeoutStartTimestamp: SAVED_AT } }),
	};
}

async function row() {
	const screen = await realDb.query.screens.findFirst({ where: eq(schema.screens.id, screenId) });
	return { cardId: (screen?.activeCard as { id?: string } | null)?.id ?? null, version: screen!.activeCardVersion };
}

const kvKey = () => `event:${eventId}:screen:${screenId}:card`;
const announced = () => published.map(message => message.type);

beforeAll(async () => {
	const [event] = await realDb.insert(schema.events)
		.values({ name: 'Card Expiry', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
});

let screenSeq = 0;
beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(SAVED_AT);
	screenSeq += 1;
	const [screen] = await realDb.insert(schema.screens)
		.values({
			eventId,
			name: `Card ${screenSeq}`,
			slug: `card-${screenSeq}`,
			currentMode: 'card',
			assetCapabilitySeed: `seed-${screenSeq}`,
			assetCapabilityDigest: `digest-${screenSeq}`,
		})
		.returning({ id: schema.screens.id });
	screenId = screen!.id;
	published.length = 0;
	kv.clear();
	afterCardRowLoaded = null;
});

afterAll(async () => {
	vi.useRealTimers();
	await harness.close();
});

describe('saving a timed Card', () => {
	it('advances the revision and announces the Card with its absolute expiry', async () => {
		await putCard(request(card('bolt', 5_000)));

		expect(await row()).toEqual({ cardId: 'bolt', version: 1 });
		expect(kv.has(kvKey())).toBe(true);
		expect(published).toEqual([
			{ type: 'card:timeout', data: { screenId, timeoutDuration: 5_000, expiresAt: SAVED_AT + 5_000 } },
			{ type: 'card:updated', data: expect.objectContaining({ screenId, card: expect.objectContaining({ id: 'bolt' }) }) },
		]);
	});

	it('schedules nothing on the server: no time passing changes the row', async () => {
		await putCard(request(card('bolt', 5_000)));
		published.length = 0;

		// The save left no timer behind, and an hour after every client has gone nothing has run.
		expect(vi.getTimerCount()).toBe(0);
		vi.setSystemTime(SAVED_AT + 60 * 60_000);
		await vi.runAllTimersAsync();

		expect(await row()).toEqual({ cardId: 'bolt', version: 1 });
		expect(kv.has(kvKey())).toBe(true);
		expect(published).toEqual([]);
	});
});

describe.each([
	['an operator read', getCard],
	['a Screen Output read', getOutputCard],
])('%s of a timed Card', (_reader, read) => {
	it('before expiry answers the Card and changes nothing', async () => {
		await putCard(request(card('bolt', 5_000)));
		published.length = 0;

		vi.setSystemTime(SAVED_AT + 4_999);
		await expect(read(request())).resolves.toMatchObject({ id: 'bolt' });

		expect(await row()).toEqual({ cardId: 'bolt', version: 1 });
		expect(published).toEqual([]);
	});

	it('at expiry answers no Card, clears the row, advances the revision, and announces nothing', async () => {
		await putCard(request(card('bolt', 5_000)));
		published.length = 0;

		vi.setSystemTime(SAVED_AT + 5_000);
		await expect(read(request())).resolves.toBeNull();

		expect(await row()).toEqual({ cardId: null, version: 2 });
		expect(kv.has(kvKey())).toBe(false);
		expect(published).toEqual([]);
	});

	it('after the row is cleared, a later read writes nothing', async () => {
		await putCard(request(card('bolt', 5_000)));
		vi.setSystemTime(SAVED_AT + 5_000);
		await read(request());
		published.length = 0;

		await expect(read(request())).resolves.toBeNull();

		expect(await row()).toEqual({ cardId: null, version: 2 });
		expect(published).toEqual([]);
	});

	it('loses its cleanup to a replacement saved after it loaded the row, and still answers no Card', async () => {
		await putCard(request(card('bolt', 5_000)));
		vi.setSystemTime(SAVED_AT + 5_000);
		afterCardRowLoaded = async () => void await putCard(request(card('counterspell')));
		published.length = 0;

		// The guard keeps the replacement; the answer is the expired Card's, not the row's.
		await expect(read(request())).resolves.toBeNull();

		expect(await row()).toEqual({ cardId: 'counterspell', version: 2 });
		expect(announced()).toEqual(['card:updated']);
	});
});

describe('the operator client\'s expiry DELETE', () => {
	it('clears the row, advances the revision, and announces the clear', async () => {
		await putCard(request(card('bolt', 5_000)));
		vi.setSystemTime(SAVED_AT + 5_000);
		published.length = 0;

		await deleteCard(request());

		expect(await row()).toEqual({ cardId: null, version: 2 });
		expect(kv.has(kvKey())).toBe(false);
		expect(announced()).toEqual(['card:timeout:cancel', 'card:cleared']);
	});

	it('is repeated by every operator client holding the Screen, each one a revision and a clear', async () => {
		await putCard(request(card('bolt', 5_000)));
		vi.setSystemTime(SAVED_AT + 5_000);
		published.length = 0;

		await deleteCard(request());
		await deleteCard(request());

		expect(await row()).toEqual({ cardId: null, version: 3 });
		expect(announced()).toEqual(['card:timeout:cancel', 'card:cleared', 'card:timeout:cancel', 'card:cleared']);
	});

	it('is unguarded: a stale one arriving after a replacement clears the replacement', async () => {
		await putCard(request(card('bolt', 5_000)));
		vi.setSystemTime(SAVED_AT + 5_000);
		// Another operator replaces the Card while this client's expiry DELETE is in flight.
		await putCard(request(card('counterspell')));
		published.length = 0;

		await deleteCard(request());

		expect(await row()).toEqual({ cardId: null, version: 3 });
		expect(announced()).toEqual(['card:timeout:cancel', 'card:cleared']);
	});
});

describe('a Screen read', () => {
	it('ships the stored Card and its revision raw, expired or not, beside the projected Card read', async () => {
		await putCard(request(card('bolt', 5_000)));
		vi.setSystemTime(SAVED_AT + 5_000);

		// `ScreenResponse` declares neither field; the mapper passes them through untyped.
		await expect(getOutputScreen(request())).resolves.toMatchObject({
			activeCard: expect.objectContaining({ id: 'bolt' }),
			activeCardVersion: 1,
		});
	});
});
