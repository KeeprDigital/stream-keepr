import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createScryfallFake } from '~~/test/helpers/scryfallFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Broadcast Deck List write over real SQL and the real import: the rows it
// stores, what it answers and announces, and what a refusal leaves as it was.
// Faked: Scryfall's HTTP API and Ably.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown; cause?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

/** Scryfall as the write reaches it: the cards it knows, whether it is down, and how often it was asked. */
const scryfall = {
	cards: createScryfallFake([
		{
			id: 'lightning-bolt',
			name: 'Lightning Bolt',
			set: 'lea',
			type_line: 'Instant',
		},
		{
			id: 'counterspell',
			name: 'Counterspell',
			set: 'lea',
			type_line: 'Instant',
		},
	]),
	down: false,
	asked: 0,
};
vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
	scryfall.asked += 1;
	return scryfall.down
		? new Response('unavailable', { status: 503 })
		: await scryfall.cards.fetch(input, init);
});

const { broadcastDeckListWriteModule } = await import('~~/server/modules/broadcast-deck-list-write');
const write = broadcastDeckListWriteModule();

async function stageEvent(values: Partial<typeof schema.events.$inferInsert> = {}) {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			...values,
		})
		.returning({ id: schema.events.id });
	return event!.id;
}

/** A saved list of four Lightning Bolt at revision 1, with what saving it asked and announced wiped. */
async function stageList(eventId: number, name = 'Burn') {
	const list = await write.createBroadcastDeckList({
		eventId,
		input: { name, sourceText: '4 Lightning Bolt' },
	});
	ably.reset();
	scryfall.asked = 0;
	return list;
}

/** A Screen whose saved Deck Source is the list, whatever mode it shows. */
async function stageSelectingScreen(eventId: number, listId: number, name: string) {
	const [screen] = await db.insert(schema.screens).values({
		eventId,
		name,
		slug: `${name.toLowerCase()}-${eventId}`,
		modeConfigs: {
			deck: {
				deckSource: { type: 'broadcast', broadcastDeckListId: listId },
			},
		} as never,
		assetCapabilitySeed: `seed-${name}-${eventId}`,
		assetCapabilityDigest: `digest-${name}-${eventId}`,
	}).returning({ id: schema.screens.id, name: schema.screens.name });
	return screen!;
}

async function storedLists(eventId: number) {
	return await db.select({
		id: schema.broadcastDeckLists.id,
		name: schema.broadcastDeckLists.name,
		revision: schema.broadcastDeckLists.revision,
		sourceText: schema.broadcastDeckLists.sourceText,
	}).from(schema.broadcastDeckLists).where(eq(schema.broadcastDeckLists.eventId, eventId)).orderBy(asc(schema.broadcastDeckLists.id));
}

/** The list's stored cards as `[compartment, quantity, name]`. */
async function storedCards(listId: number) {
	const entries = await db.select().from(schema.broadcastDeckListEntries).where(eq(schema.broadcastDeckListEntries.listId, listId)).orderBy(asc(schema.broadcastDeckListEntries.id));
	return entries.map(entry => [entry.compartment, entry.quantity, entry.canonicalName]);
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [type, payload]);
}

const BURN = {
	id: expect.any(Number),
	name: 'Burn',
	revision: 1,
	sourceText: '4 Lightning Bolt',
};

beforeEach(() => {
	ably.reset();
	scryfall.down = false;
	scryfall.asked = 0;
});
afterAll(async () => await harness.close());

describe('a Broadcast Deck List write that is accepted', () => {
	it('creates the list with the cards its source resolves to, answers it and announces it under the writer\'s origin', async () => {
		const eventId = await stageEvent();
		const sourceText = '4 Lightning Bolt\nSideboard\n2 Counterspell';

		const created = await write.createBroadcastDeckList({
			eventId,
			input: { name: 'Burn', sourceText },
			originConnectionId: 'origin-1',
		});

		expect(created).toMatchObject({
			eventId,
			name: 'Burn',
			revision: 1,
			mainboardQuantity: 4,
			sideboardQuantity: 2,
		});
		expect(await storedLists(eventId)).toEqual([
			{
				id: created.id,
				name: 'Burn',
				revision: 1,
				sourceText,
			},
		]);
		expect(await storedCards(created.id)).toEqual([
			['mainboard', 4, 'Lightning Bolt'],
			['sideboard', 2, 'Counterspell'],
		]);
		expect(announced(eventId)).toEqual([
			[
				'broadcastDeckList:created',
				{ listId: created.id, revision: 1, originConnectionId: 'origin-1' },
			],
		]);
	});

	// Resolving an Unresolved Deck Card names its card for every Deck List in the Event.
	it('reads a name the Event has resolved to a card as that card', async () => {
		const eventId = await stageEvent();
		const [card] = await db.insert(schema.cards).values({ name: 'Lightning Bolt', game: 'mtg' }).returning({ id: schema.cards.id });
		await db.insert(schema.eventCardNameOverrides).values({
			eventId,
			inputName: 'Litning Bolt',
			normalizedInputName: 'litning bolt',
			resolvedCardId: card!.id,
		});

		const created = await write.createBroadcastDeckList({
			eventId,
			input: { name: 'Burn', sourceText: '4 Litning Bolt' },
		});

		expect(await storedCards(created.id)).toEqual([
			['mainboard', 4, 'Lightning Bolt'],
		]);
	});

	it('renames a list without asking Scryfall, keeping its saved cards and announcing its new revision', async () => {
		const eventId = await stageEvent();
		const list = await stageList(eventId);

		const answer = await write.updateBroadcastDeckList({
			eventId,
			listId: list.id,
			input: { expectedRevision: 1, name: 'Renamed' },
			originConnectionId: 'origin-1',
		});

		expect(answer).toMatchObject({ id: list.id, name: 'Renamed', revision: 2 });
		expect(scryfall.asked).toBe(0);
		expect(await storedLists(eventId)).toEqual([
			{ ...BURN, name: 'Renamed', revision: 2 },
		]);
		expect(await storedCards(list.id)).toEqual([
			['mainboard', 4, 'Lightning Bolt'],
		]);
		expect(announced(eventId)).toEqual([
			[
				'broadcastDeckList:updated',
				{ listId: list.id, revision: 2, originConnectionId: 'origin-1' },
			],
		]);
	});

	it('replaces a list\'s saved cards with those a new source resolves to', async () => {
		const eventId = await stageEvent();
		const list = await stageList(eventId);

		await write.updateBroadcastDeckList({
			eventId,
			listId: list.id,
			input: { expectedRevision: 1, sourceText: '2 Counterspell' },
		});

		expect(await storedLists(eventId)).toEqual([
			{ ...BURN, revision: 2, sourceText: '2 Counterspell' },
		]);
		expect(await storedCards(list.id)).toEqual([
			['mainboard', 2, 'Counterspell'],
		]);
	});

	it('deletes a list no Screen selects and announces it gone', async () => {
		const eventId = await stageEvent();
		const list = await stageList(eventId);

		const answer = await write.deleteBroadcastDeckList({
			eventId,
			listId: list.id,
			expectedRevision: 1,
			originConnectionId: 'origin-1',
		});

		expect(answer).toEqual({ success: true });
		expect(await storedLists(eventId)).toEqual([]);
		expect(announced(eventId)).toEqual([
			[
				'broadcastDeckList:deleted',
				{ listId: list.id, originConnectionId: 'origin-1' },
			],
		]);
	});
});

describe('a source the import refuses', () => {
	it('refuses a create with each error of its source, storing and announcing nothing', async () => {
		const eventId = await stageEvent();

		await expect(write.createBroadcastDeckList({
			eventId,
			input: { name: 'Burn', sourceText: 'Island' },
		})).rejects.toMatchObject({
			statusCode: 422,
			data: {
				code: 'BROADCAST_DECK_LIST_INVALID',
				errors: [
					{ lineNumber: 1, code: 'INVALID_CARD_LINE', sourceText: 'Island' },
				],
			},
		});

		expect(await storedLists(eventId)).toEqual([]);
		expect(ably.published).toEqual([]);
	});

	it('refuses a replacement naming a card Scryfall does not know, leaving the saved list as it was', async () => {
		const eventId = await stageEvent();
		const list = await stageList(eventId);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(write.updateBroadcastDeckList({
			eventId,
			listId: list.id,
			input: { expectedRevision: 1, name: 'Renamed', sourceText: '1 Nope' },
		})).rejects.toMatchObject({
			statusCode: 422,
			data: {
				code: 'BROADCAST_DECK_LIST_INVALID',
				errors: [
					{
						lineNumber: 1,
						code: 'UNRESOLVED_CARD',
						message: 'Could not resolve Nope',
						sourceText: '1 Nope',
					},
				],
			},
		});

		expect(await storedLists(eventId)).toEqual([BURN]);
		expect(await storedCards(list.id)).toEqual([
			['mainboard', 4, 'Lightning Bolt'],
		]);
		expect(ably.published).toEqual([]);
	});
});

describe('a write while Scryfall is down', () => {
	// An outage is not an unknown card: the operator can send the same source again.
	it('fails a create as a retryable card provider outage, storing and announcing nothing', async () => {
		const eventId = await stageEvent();
		scryfall.down = true;
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(write.createBroadcastDeckList({
			eventId,
			input: { name: 'Burn', sourceText: '4 Lightning Bolt' },
		})).rejects.toMatchObject({
			cause: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true },
		});

		expect(await storedLists(eventId)).toEqual([]);
		expect(ably.published).toEqual([]);
	});
});

describe('a write that lost to another', () => {
	it.each([
		{
			write: 'an update',
			attempt: (eventId: number, listId: number) => write.updateBroadcastDeckList({
				eventId,
				listId,
				input: { expectedRevision: 1, name: 'Stale' },
			}),
		},
		{
			write: 'a delete',
			attempt: (eventId: number, listId: number) => write.deleteBroadcastDeckList({ eventId, listId, expectedRevision: 1 }),
		},
	])('refuses $write from a revision since replaced, answering the list as it now is', async ({ attempt }) => {
		const eventId = await stageEvent();
		const list = await stageList(eventId);
		await write.updateBroadcastDeckList({
			eventId,
			listId: list.id,
			input: { expectedRevision: 1, name: 'Winner' },
		});
		ably.reset();

		await expect(attempt(eventId, list.id)).rejects.toMatchObject({
			statusCode: 409,
			data: {
				code: 'BROADCAST_DECK_LIST_REVISION_CONFLICT',
				current: {
					id: list.id,
					name: 'Winner',
					revision: 2,
					sourceText: '4 Lightning Bolt',
				},
			},
		});

		expect(await storedLists(eventId)).toEqual([
			{ ...BURN, name: 'Winner', revision: 2 },
		]);
		expect(ably.published).toEqual([]);
	});

	it.each([
		{
			write: 'a create',
			attempt: (eventId: number, _listId: number) => write.createBroadcastDeckList({
				eventId,
				input: { name: '  CONTROL ', sourceText: '2 Counterspell' },
			}),
		},
		{
			write: 'a rename',
			attempt: (eventId: number, listId: number) => write.updateBroadcastDeckList({
				eventId,
				listId,
				input: { expectedRevision: 1, name: 'control' },
			}),
		},
	])('refuses $write taking a name another list of the Event holds', async ({ attempt }) => {
		const eventId = await stageEvent();
		await stageList(eventId, 'Control');
		const list = await stageList(eventId);

		await expect(attempt(eventId, list.id)).rejects.toMatchObject({
			statusCode: 409,
			message: 'A Broadcast Deck List with this name already exists in this Event',
			data: { code: 'BROADCAST_DECK_LIST_NAME_CONFLICT' },
		});

		expect(await storedLists(eventId)).toEqual([
			{ ...BURN, name: 'Control' },
			BURN,
		]);
		expect(ably.published).toEqual([]);
	});
});

describe('a write to a list the Event does not hold', () => {
	it.each([
		{
			write: 'an update',
			attempt: (eventId: number, listId: number) => write.updateBroadcastDeckList({
				eventId,
				listId,
				input: { expectedRevision: 1, name: 'Renamed' },
			}),
		},
		{
			write: 'a delete',
			attempt: (eventId: number, listId: number) => write.deleteBroadcastDeckList({ eventId, listId, expectedRevision: 1 }),
		},
	])('refuses $write of another Event\'s list as not found, leaving it as it was', async ({ attempt }) => {
		const eventId = await stageEvent();
		const otherEventId = await stageEvent();
		const list = await stageList(otherEventId);

		await expect(attempt(eventId, list.id)).rejects.toMatchObject({
			statusCode: 404,
			message: 'Broadcast Deck List not found',
		});

		expect(await storedLists(otherEventId)).toEqual([BURN]);
		expect(ably.published).toEqual([]);
	});
});

describe('a delete of a list Screens select', () => {
	it.each([
		{
			screens: ['Studio'],
			message: 'Broadcast Deck List is selected by Screen: Studio',
		},
		{
			screens: ['Studio', 'Alpha'],
			message: 'Broadcast Deck List is selected by Screens: Alpha, Studio',
		},
	])('is refused naming them: $message', async ({ screens, message }) => {
		const eventId = await stageEvent({ broadcastDeckListsEnabled: true });
		const list = await stageList(eventId);
		const selecting: { id: number; name: string }[] = [];
		for (const name of screens)
			selecting.push(await stageSelectingScreen(eventId, list.id, name));

		await expect(write.deleteBroadcastDeckList({
			eventId,
			listId: list.id,
			expectedRevision: 1,
		})).rejects.toMatchObject({
			statusCode: 409,
			message,
			data: {
				code: 'BROADCAST_DECK_LIST_IN_USE',
				screens: selecting.toSorted((a, b) => a.name.localeCompare(b.name)),
			},
		});

		expect(await storedLists(eventId)).toEqual([BURN]);
		expect(ably.published).toEqual([]);
	});
});

describe('a write to an Event that holds no Broadcast Deck Lists', () => {
	// A list row under a One Piece Card Game Event is still out of reach of every write.
	it.each([
		{
			write: 'a create',
			attempt: (eventId: number, _listId: number) => write.createBroadcastDeckList({
				eventId,
				input: { name: 'Deck', sourceText: '4 Lightning Bolt' },
			}),
		},
		{
			write: 'an update',
			attempt: (eventId: number, listId: number) => write.updateBroadcastDeckList({
				eventId,
				listId,
				input: { expectedRevision: 1, name: 'Renamed' },
			}),
		},
		{
			write: 'a delete',
			attempt: (eventId: number, listId: number) => write.deleteBroadcastDeckList({ eventId, listId, expectedRevision: 1 }),
		},
	// Which Events hold Broadcast Deck Lists is `holdsBroadcastDeckLists`'s; a Commander Event holds none (ADR-0087).
	])('refuses $write in an Event that holds no Broadcast Deck Lists before resolving or storing anything', async ({ attempt }) => {
		const eventId = await stageEvent({ game: 'mtg', variant: 'commander' });
		const [list] = await db.insert(schema.broadcastDeckLists)
			.values({
				eventId,
				name: 'Burn',
				normalizedName: 'burn',
				sourceText: '4 Lightning Bolt',
			})
			.returning({ id: schema.broadcastDeckLists.id });

		await expect(attempt(eventId, list!.id)).rejects.toMatchObject({
			statusCode: 400,
			message: 'Broadcast Deck Lists are only supported for Two-Player Magic: The Gathering Events',
		});

		expect(scryfall.asked).toBe(0);
		expect(await storedLists(eventId)).toEqual([BURN]);
		expect(ably.published).toEqual([]);
	});

	it('refuses a write to an Event that does not exist as not found', async () => {
		const eventId = await stageEvent();
		await db.delete(schema.events).where(eq(schema.events.id, eventId));

		await expect(write.createBroadcastDeckList({
			eventId,
			input: { name: 'Deck', sourceText: '4 Lightning Bolt' },
		})).rejects.toMatchObject({ statusCode: 404, message: 'Event not found' });

		expect(scryfall.asked).toBe(0);
	});
});
