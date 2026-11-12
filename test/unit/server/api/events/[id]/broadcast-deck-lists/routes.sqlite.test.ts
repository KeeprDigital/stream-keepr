import type { H3Event } from 'h3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createScryfallFake } from '~~/test/helpers/scryfallFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Broadcast Deck List routes over real SQL: what a read answers of its Event,
// and what a write passes on from its path, body and origin. The write's rules are
// `broadcastDeckListWrite.sqlite.test.ts`'s. Faked: Scryfall's HTTP API and Ably.

interface StubRequest { params: Record<string, string>; body: unknown; headers: Record<string, string> }
/** The status the route last set on its response. */
let responseStatus: number | undefined;
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('getHeader', (event: StubRequest, name: string) => event.headers[name]);
vi.stubGlobal('setResponseStatus', (_event: StubRequest, status: number) => {
	responseStatus = status;
});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

vi.stubGlobal('fetch', createScryfallFake([
	{
		id: 'lightning-bolt',
		name: 'Lightning Bolt',
		set: 'lea',
		type_line: 'Instant',
	},
]).fetch);

type Handler = (event: H3Event) => Promise<unknown>;
const listRoute = (await import('~~/server/api/events/[id]/broadcast-deck-lists/index.get')).default as unknown as Handler;
const createRoute = (await import('~~/server/api/events/[id]/broadcast-deck-lists/index.post')).default as unknown as Handler;
const readRoute = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.get')).default as unknown as Handler;
const updateRoute = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.patch')).default as unknown as Handler;
const deleteRoute = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.delete')).default as unknown as Handler;

async function stageEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

/** A saved list of four Lightning Bolt at revision 1. */
async function stageList(eventId: number, name: string) {
	const [list] = await db.insert(schema.broadcastDeckLists)
		.values({
			eventId,
			name,
			normalizedName: name.toLowerCase(),
			sourceText: '4 Lightning Bolt',
		})
		.returning({ id: schema.broadcastDeckLists.id });
	await db.insert(schema.broadcastDeckListEntries).values({
		listId: list!.id,
		compartment: 'mainboard',
		quantity: 4,
		sortOrder: 0,
		canonicalName: 'Lightning Bolt',
		scryfallId: 'lightning-bolt',
		setCode: 'lea',
	});
	return list!.id;
}

/** Calls a route as h3 would: path parameters as text, sent from connection `origin-1`. */
function call(route: Handler, path: { id: number; listId?: number }, body?: unknown) {
	return route(stubH3Event({
		params: Object.fromEntries(Object.entries(path).map(([name, value]) => [
			name,
			String(value),
		])),
		body,
		headers: { 'x-realtime-connection-id': 'origin-1' },
	}));
}

async function storedLists(eventId: number) {
	return await db.select({
		id: schema.broadcastDeckLists.id,
		name: schema.broadcastDeckLists.name,
		revision: schema.broadcastDeckLists.revision,
	}).from(schema.broadcastDeckLists).where(eq(schema.broadcastDeckLists.eventId, eventId)).orderBy(asc(schema.broadcastDeckLists.id));
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [type, payload]);
}

beforeEach(() => {
	ably.reset();
	responseStatus = undefined;
});
afterAll(async () => await harness.close());

describe('reading an Event\'s Broadcast Deck Lists', () => {
	it('lists the Event\'s own lists as summaries, with their count', async () => {
		const eventId = await stageEvent();
		const zooId = await stageList(eventId, 'Zoo');
		const burnId = await stageList(eventId, 'Burn');
		await stageList(await stageEvent(), 'Elsewhere');

		await expect(call(listRoute, { id: eventId })).resolves.toEqual({
			broadcastDeckLists: [
				expect.objectContaining({ id: burnId, name: 'Burn', mainboardQuantity: 4 }),
				expect.objectContaining({ id: zooId, name: 'Zoo', mainboardQuantity: 4 }),
			],
			total: 2,
		});
	});

	it('reads one list of the Event whole', async () => {
		const eventId = await stageEvent();
		const listId = await stageList(eventId, 'Burn');

		await expect(call(readRoute, { id: eventId, listId })).resolves.toMatchObject({
			id: listId,
			eventId,
			name: 'Burn',
			sourceText: '4 Lightning Bolt',
			entries: [
				{ compartment: 'mainboard', quantity: 4, canonicalName: 'Lightning Bolt' },
			],
		});
	});

	it.each([
		{
			list: 'a list that does not exist',
			stage: async () => 999_999,
		},
		{
			list: 'a list of another Event',
			stage: async () => await stageList(await stageEvent(), 'Elsewhere'),
		},
	])('answers $list with 404', async ({ stage }) => {
		const eventId = await stageEvent();
		const listId = await stage();

		await expect(call(readRoute, { id: eventId, listId })).rejects.toMatchObject({
			statusCode: 404,
			message: 'Broadcast Deck List not found',
		});
	});
});

describe('writing a Broadcast Deck List through its routes', () => {
	it('answers a create with 201 and the stored list, announced under the writer\'s origin', async () => {
		const eventId = await stageEvent();

		const answer = await call(createRoute, { id: eventId }, { name: '  Burn ', sourceText: '4 Lightning Bolt' });

		expect(responseStatus).toBe(201);
		const [stored] = await storedLists(eventId);
		expect(stored).toEqual({
			id: expect.any(Number),
			name: 'Burn',
			revision: 1,
		});
		expect(answer).toMatchObject({
			...stored,
			eventId,
			sourceText: '4 Lightning Bolt',
			mainboardQuantity: 4,
		});
		expect(announced(eventId)).toEqual([
			[
				'broadcastDeckList:created',
				{ listId: stored!.id, revision: 1, originConnectionId: 'origin-1' },
			],
		]);
	});

	it('updates the list its path names from the revision its body carries', async () => {
		const eventId = await stageEvent();
		const keptId = await stageList(eventId, 'Zoo');
		const listId = await stageList(eventId, 'Burn');

		const answer = await call(updateRoute, { id: eventId, listId }, { expectedRevision: 1, name: 'Renamed' });

		expect(answer).toMatchObject({ id: listId, name: 'Renamed', revision: 2 });
		expect(await storedLists(eventId)).toEqual([
			{ id: keptId, name: 'Zoo', revision: 1 },
			{ id: listId, name: 'Renamed', revision: 2 },
		]);
		expect(announced(eventId)).toEqual([
			[
				'broadcastDeckList:updated',
				{ listId, revision: 2, originConnectionId: 'origin-1' },
			],
		]);
	});

	it('deletes the list its path names at the revision its body carries', async () => {
		const eventId = await stageEvent();
		const keptId = await stageList(eventId, 'Zoo');
		const listId = await stageList(eventId, 'Burn');

		const answer = await call(deleteRoute, { id: eventId, listId }, { expectedRevision: 1 });

		expect(answer).toEqual({ success: true });
		expect(await storedLists(eventId)).toEqual([
			{ id: keptId, name: 'Zoo', revision: 1 },
		]);
		expect(announced(eventId)).toEqual([
			[
				'broadcastDeckList:deleted',
				{ listId, originConnectionId: 'origin-1' },
			],
		]);
	});
});
