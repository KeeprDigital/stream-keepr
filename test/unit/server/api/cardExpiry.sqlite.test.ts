import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Card's expiry is a clock projection that no read, client or timer writes
 * (ADR-0022, #707, #725). Each row is one of #707's acceptance scenarios for a
 * Card saved at T₀ with timeout D, and says which.
 *
 * The Card and Screen routes run as written over real SQLite (the Card's
 * revision is SQL). Only admission and transport are stood in for: every
 * announcement is recorded instead of sent, and the Screen Output reads are
 * admitted without a capability.
 *
 * What a row here observes, and why each is observed where it is:
 * - **durable state** is the Screen row's `activeCard`, `activeCardVersion`
 *   (its revision) and `updatedAt`. No route answers them, so they are read from
 *   the row: "a read writes nothing" means these do not move.
 * - **announcements** are the realtime messages the server published.
 * - **the derived copy** is the KV key the service mirrors the Card into.
 */

const harness = await createSqliteD1Harness();
const realDb = drizzle(harness.database, { schema });

/**
 * Runs once, between the Card read loading its row and answering, so a test can
 * place a concurrent write exactly there.
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
						// The Card read loads only the Card column; the routes' Screen lookups load whole rows.
						const hook = args[0]?.columns?.activeCard ? afterCardRowLoaded : null;
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

interface StubEvent { params: Record<string, string>; body?: unknown; context?: Record<string, unknown> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

// Admission is ADR-0022's and pinned elsewhere; this suite is about what a read does once admitted.
async function admitScreenOutputRead(event: StubEvent) {
	const eventId = Number(event.params.id);
	const screen = await realDb.query.screens.findFirst({ where: eq(schema.screens.id, Number(event.params.screenId)) });
	return { eventId, screen, reader: 'capability' };
}
vi.doMock('~~/server/utils/screenOutputRead', () => ({
	requireScreenOutputRead: admitScreenOutputRead,
	requireScreenOutputModeRead: admitScreenOutputRead,
}));
vi.doMock('~~/server/utils/screenOutputAuthorization', () => ({
	canReadScreenOutput: async () => true,
}));

type Handler = (event: H3Event) => Promise<unknown>;
const putCard = (await import('~~/server/api/events/[id]/screens/[screenId]/card/index.put')).default as unknown as Handler;
const getCard = (await import('~~/server/api/events/[id]/screens/[screenId]/card/index.get')).default as unknown as Handler;
const deleteCard = (await import('~~/server/api/events/[id]/screens/[screenId]/card/index.delete')).default as unknown as Handler;
const getOutputCard = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/card.get')).default as unknown as Handler;
const listScreens = (await import('~~/server/api/events/[id]/screens/index.get')).default as unknown as Handler;
const getScreen = (await import('~~/server/api/events/[id]/screens/[screenId]/index.get')).default as unknown as Handler;
const getOutputScreen = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/index.get')).default as unknown as Handler;
const getOutputScreenBySlug = (await import('~~/server/api/screen-output/events/[id]/screens/slug/[slug].get')).default as unknown as Handler;

let eventId: number;
let screenId: number;
let screenSlug: string;
const SAVED_AT = Date.UTC(2026, 9, 21, 12, 0, 0);
const D = 5_000;

function request(body?: unknown): H3Event {
	return stubH3Event({ params: { id: String(eventId), screenId: String(screenId), slug: screenSlug }, body, context: {} });
}

function card(id: string, timeoutDuration?: number, timeoutStartTimestamp = SAVED_AT) {
	return {
		id,
		name: id,
		set: 'lea',
		layout: 'normal',
		imageData: { front: null, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
		...(timeoutDuration === undefined ? {} : { timeoutData: { timeoutDuration, timeoutStartTimestamp } }),
	};
}

const kvKey = () => `event:${eventId}:screen:${screenId}:card`;

/** The Screen row's durable Card state, everything a write would move. */
async function stored() {
	const screen = await realDb.query.screens.findFirst({ where: eq(schema.screens.id, screenId) });
	return {
		cardId: (screen?.activeCard as { id?: string } | null)?.id ?? null,
		version: screen!.activeCardVersion,
		updatedAt: screen!.updatedAt.getTime(),
		kv: (kv.get(kvKey()) as { id?: string } | undefined)?.id ?? null,
	};
}

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
	screenSlug = `card-${screenSeq}`;
	const [screen] = await realDb.insert(schema.screens)
		.values({
			eventId,
			name: `Card ${screenSeq}`,
			slug: screenSlug,
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
	it('stores it, advances the revision, and announces only card:updated carrying its timeout (scenario 1)', async () => {
		await putCard(request(card('bolt', D)));

		expect(await stored()).toMatchObject({ cardId: 'bolt', version: 1, kv: 'bolt' });
		expect(published).toEqual([
			{
				type: 'card:updated',
				data: expect.objectContaining({
					screenId,
					card: expect.objectContaining({ id: 'bolt', timeoutData: { timeoutDuration: D, timeoutStartTimestamp: SAVED_AT } }),
				}),
			},
		]);
	});

	it('stores and announces a Card whose timeout already elapsed, and nothing clears it (scenario 10)', async () => {
		vi.setSystemTime(SAVED_AT + 2 * D);

		await putCard(request(card('bolt', D)));

		expect(await stored()).toMatchObject({ cardId: 'bolt', version: 1, kv: 'bolt' });
		expect(announced()).toEqual(['card:updated']);
		await expect(getCard(request())).resolves.toMatchObject({ card: null });
		expect(await stored()).toMatchObject({ cardId: 'bolt', version: 1, kv: 'bolt' });
	});
});

describe.each([
	['an operator read', getCard],
	['a Screen Output read', getOutputCard],
])('%s of a timed Card', (_reader, read) => {
	it('before expiry answers the Card and writes nothing (scenario 2)', async () => {
		await putCard(request(card('bolt', D)));
		const before = await stored();
		published.length = 0;

		vi.setSystemTime(SAVED_AT + D - 1);
		await expect(read(request())).resolves.toMatchObject({ card: { id: 'bolt' } });

		expect(await stored()).toEqual(before);
		expect(published).toEqual([]);
	});

	it('at expiry answers no Card and writes nothing, however often it is repeated (scenario 3)', async () => {
		await putCard(request(card('bolt', D)));
		const before = await stored();
		published.length = 0;

		vi.setSystemTime(SAVED_AT + D);
		await expect(read(request())).resolves.toMatchObject({ card: null });
		await expect(read(request())).resolves.toMatchObject({ card: null });

		expect(await stored()).toEqual(before);
		expect(published).toEqual([]);
	});

	it('an hour after every client left still finds storage as the save left it, and writes nothing (scenario 5)', async () => {
		await putCard(request(card('bolt', D)));
		const before = await stored();
		published.length = 0;

		// The save left no timer behind, so nothing runs while nobody is connected.
		expect(vi.getTimerCount()).toBe(0);
		vi.setSystemTime(SAVED_AT + D + 60 * 60_000);
		await vi.runAllTimersAsync();
		expect(await stored()).toEqual(before);

		await expect(read(request())).resolves.toMatchObject({ card: null });

		expect(await stored()).toEqual(before);
		expect(published).toEqual([]);
	});

	it('that loaded the row before a replacement leaves the replacement in storage (scenario 7)', async () => {
		await putCard(request(card('bolt', D)));
		vi.setSystemTime(SAVED_AT + D);
		afterCardRowLoaded = async () => void await putCard(request(card('counterspell')));
		published.length = 0;

		// Ordering this answer against the newer card:updated is the Card read's freshness (#704).
		await expect(read(request())).resolves.toMatchObject({ card: null });

		expect(await stored()).toMatchObject({ cardId: 'counterspell', version: 2, kv: 'counterspell' });
		expect(announced()).toEqual(['card:updated']);
	});
});

describe('a replacement saved just before the replaced Card expires', () => {
	it('stands past that expiry: no read clears it and nothing announces a clear (scenario 6)', async () => {
		await putCard(request(card('bolt', D)));
		// Operator B replaces the Card just before operator A's timer for it fires.
		vi.setSystemTime(SAVED_AT + D - 1);
		await putCard(request(card('counterspell')));
		const replaced = await stored();

		vi.setSystemTime(SAVED_AT + D);
		await expect(getCard(request())).resolves.toMatchObject({ card: { id: 'counterspell' } });
		await expect(getOutputCard(request())).resolves.toMatchObject({ card: { id: 'counterspell' } });

		expect(replaced).toMatchObject({ cardId: 'counterspell', version: 2 });
		expect(await stored()).toEqual(replaced);
		expect(announced()).toEqual(['card:updated', 'card:updated']);
	});
});

describe('the operator\'s explicit Clear', () => {
	it('clears the stored Card, advances the revision, and announces only card:cleared (scenario 8)', async () => {
		await putCard(request(card('bolt', D)));
		vi.setSystemTime(SAVED_AT + 1_000);
		published.length = 0;

		await deleteCard(request());

		expect(await stored()).toMatchObject({ cardId: null, version: 2, kv: null });
		expect(announced()).toEqual(['card:cleared']);
	});
});

describe.each([
	['the operator Screen list', async () => ((await listScreens(request())) as { screens: Array<{ id: number }> }).screens.find(screen => screen.id === screenId)],
	['the operator Screen read', async () => await getScreen(request())],
	['the Screen Output Screen read by id', async () => await getOutputScreen(request())],
	['the Screen Output Screen read by slug', async () => await getOutputScreenBySlug(request())],
])('%s', (_route, readScreen) => {
	it('carries no Card and no Card revision, expired or not (scenario 9)', async () => {
		await putCard(request(card('bolt', D)));

		const live = await readScreen();
		vi.setSystemTime(SAVED_AT + D);
		const expired = await readScreen();

		for (const screen of [live, expired]) {
			expect(screen).toMatchObject({ id: screenId });
			expect(screen).not.toHaveProperty('activeCard');
			expect(screen).not.toHaveProperty('activeCardVersion');
		}
	});
});

/**
 * The Card revision orders every Card state a holder is handed (#734): each
 * write answers the revision it committed, each announcement carries it, and
 * each read answers the revision of the row it loaded beside the Card.
 */
describe('the Card revision', () => {
	it('is answered by each save and Clear, and carried by its announcement', async () => {
		await expect(putCard(request(card('bolt')))).resolves.toEqual({ success: true, revision: 1 });
		await expect(deleteCard(request())).resolves.toEqual({ success: true, revision: 2 });
		await expect(putCard(request(card('counterspell')))).resolves.toEqual({ success: true, revision: 3 });

		expect(published).toEqual([
			{ type: 'card:updated', data: expect.objectContaining({ screenId, revision: 1, card: expect.objectContaining({ id: 'bolt' }) }) },
			{ type: 'card:cleared', data: { screenId, revision: 2 } },
			{ type: 'card:updated', data: expect.objectContaining({ screenId, revision: 3, card: expect.objectContaining({ id: 'counterspell' }) }) },
		]);
	});

	it.each([
		['an operator read', getCard],
		['a Screen Output read', getOutputCard],
	])('is answered by %s beside the Card it loaded, expired or cleared', async (_reader, read) => {
		await expect(read(request())).resolves.toEqual({ card: null, revision: 0 });

		await putCard(request(card('bolt', D)));
		await expect(read(request())).resolves.toEqual({ card: expect.objectContaining({ id: 'bolt' }), revision: 1 });

		vi.setSystemTime(SAVED_AT + D);
		await expect(read(request())).resolves.toEqual({ card: null, revision: 1 });

		await deleteCard(request());
		await expect(read(request())).resolves.toEqual({ card: null, revision: 2 });
	});

	it('answered by a read that loaded the row before a replacement is the older one', async () => {
		await putCard(request(card('bolt')));
		afterCardRowLoaded = async () => void await putCard(request(card('counterspell')));

		await expect(getCard(request())).resolves.toEqual({ card: expect.objectContaining({ id: 'bolt' }), revision: 1 });
		expect(published.at(-1)).toMatchObject({ type: 'card:updated', data: { revision: 2 } });
	});
});
