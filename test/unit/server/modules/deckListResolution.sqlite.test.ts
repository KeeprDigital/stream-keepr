import type { H3Event } from 'h3';
import type { DbPlayerDeckUnresolvedCardInsert } from '~~/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const fetchScryfallCardById = vi.fn();
const playerDeckCardsResolved = vi.fn();
const setResponseHeader = vi.fn();

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/scryfall', () => ({ fetchScryfallCardById }));
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({ playerDeckCardsResolved }),
}));
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; cause?: unknown }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), input));
vi.stubGlobal('setResponseHeader', setResponseHeader);

const { deckListResolutionModule } = await import('~~/server/modules/deck-list-resolution');

afterAll(async () => await harness.close());

const requestEvent = { request: 'deck-list-resolution' } as unknown as H3Event;
const bolt = {
	id: '11111111-1111-4111-8111-111111111111',
	name: 'Lightning Bolt',
	oracleId: 'oracle-bolt',
	typeLine: 'Instant',
	colors: 'R',
	cmc: 1,
	manaCost: '{R}',
	deckCounterTypes: [],
	deckTokens: [
		{
			id: 'treasure',
			scryfallId: null,
			name: 'Treasure',
			typeLine: 'Token Artifact',
			uri: null,
		},
	],
};

async function createEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Resolution Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function createPlayer(eventId: number) {
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Player' }).returning({ id: schema.players.id });
	return player!.id;
}

let deckSequence = 0;
async function createDeck(eventId: number, playerId: number, isPrimary = true) {
	const [deck] = await db.insert(schema.playerDecks).values({
		eventId,
		playerId,
		externalId: `deck-${++deckSequence}`,
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Deck',
		isPrimary,
	}).returning({ id: schema.playerDecks.id });
	return deck!.id;
}

/** The card catalogue is global, so a name another test already added is reused. */
async function catalogueCard(name: string) {
	await db.insert(schema.cards).values({ name, game: 'mtg' }).onConflictDoNothing();
	const [card] = await db.select({ id: schema.cards.id }).from(schema.cards).where(and(eq(schema.cards.name, name), eq(schema.cards.game, 'mtg')));
	return card!.id;
}

async function unresolved(deckId: number, overrides: Partial<DbPlayerDeckUnresolvedCardInsert> = {}) {
	const [entry] = await db.insert(schema.playerDeckUnresolvedCards).values({
		deckId,
		entryType: 'card',
		originalName: 'Lightnng Bolt',
		normalizedOriginalName: 'lightnng bolt',
		setCode: 'M11',
		normalizedSetCode: 'm11',
		quantity: 4,
		compartment: 'mainboard',
		sortOrder: 2,
		...overrides,
	}).returning({ id: schema.playerDeckUnresolvedCards.id });
	return entry!.id;
}

async function deckCards(deckId: number) {
	return await db.select({
		name: schema.cards.name,
		quantity: schema.playerDeckCards.quantity,
		compartment: schema.playerDeckCards.compartment,
		sortOrder: schema.playerDeckCards.sortOrder,
	})
		.from(schema.playerDeckCards)
		.innerJoin(schema.cards, eq(schema.cards.id, schema.playerDeckCards.cardId))
		.where(eq(schema.playerDeckCards.deckId, deckId))
		.orderBy(schema.playerDeckCards.sortOrder);
}

async function remainingUnresolved(deckId: number) {
	return await db.select().from(schema.playerDeckUnresolvedCards).where(eq(schema.playerDeckUnresolvedCards.deckId, deckId));
}

function resolve(eventId: number, unresolvedCardId: number, originConnectionId?: string) {
	return deckListResolutionModule().resolveUnresolvedDeckCard({
		eventId,
		unresolvedCardId,
		scryfallId: bolt.id,
		requestEvent,
		originConnectionId,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	fetchScryfallCardById.mockResolvedValue(bolt);
});

describe('resolving an unresolved card entry', () => {
	it('resolves the name in every Deck List of the Event that holds it, and remembers the choice', async () => {
		const eventId = await createEvent();
		const alice = await createPlayer(eventId);
		const bob = await createPlayer(eventId);
		const alicePrimary = await createDeck(eventId, alice);
		const aliceSecondary = await createDeck(eventId, alice, false);
		const bobDeck = await createDeck(eventId, bob);
		const requested = await unresolved(alicePrimary);
		await unresolved(aliceSecondary, { quantity: 1, compartment: 'sideboard', sortOrder: 0 });
		await unresolved(bobDeck, { quantity: 2, compartment: null, sortOrder: 8 });

		const result = await resolve(eventId, requested, 'origin-1');

		expect(result).toEqual({
			success: true,
			message: 'Resolved 3 entries for Lightnng Bolt as Lightning Bolt',
			resolvedCardName: 'Lightning Bolt',
			unresolvedId: requested,
			resolvedCount: 3,
		});
		expect(await deckCards(alicePrimary)).toEqual([
			{
				name: 'Lightning Bolt',
				quantity: 4,
				compartment: 'mainboard',
				sortOrder: 2,
			},
		]);
		expect(await deckCards(aliceSecondary)).toEqual([
			{
				name: 'Lightning Bolt',
				quantity: 1,
				compartment: 'sideboard',
				sortOrder: 0,
			},
		]);
		// An entry with no compartment is mainboard.
		expect(await deckCards(bobDeck)).toEqual([
			{
				name: 'Lightning Bolt',
				quantity: 2,
				compartment: 'mainboard',
				sortOrder: 8,
			},
		]);
		for (const deckId of [alicePrimary, aliceSecondary, bobDeck])
			expect(await remainingUnresolved(deckId)).toEqual([]);

		const [card] = await db.select().from(schema.cards).where(eq(schema.cards.name, 'Lightning Bolt'));
		expect(card).toMatchObject({
			scryfallId: bolt.id,
			cardType: 'Instant',
			deckTokens: [
				expect.objectContaining({ id: 'treasure' }),
			],
		});
		const [override] = await db.select().from(schema.eventCardNameOverrides).where(eq(schema.eventCardNameOverrides.eventId, eventId));
		expect(override).toMatchObject({
			inputName: 'Lightnng Bolt',
			normalizedInputName: 'lightnng bolt',
			normalizedInputSetCode: 'm11',
			resolvedCardId: card!.id,
		});

		// Every Deck List it rewrote is announced, naming each Player once.
		expect(playerDeckCardsResolved).toHaveBeenCalledWith({
			eventId,
			deckIds: expect.arrayContaining([alicePrimary, aliceSecondary, bobDeck]),
			playerIds: expect.arrayContaining([alice, bob]),
			originConnectionId: 'origin-1',
		});
		expect(playerDeckCardsResolved.mock.calls[0]?.[0].playerIds).toHaveLength(2);
	});

	it('leaves another Event\'s matching entry unresolved', async () => {
		const eventId = await createEvent();
		const otherEventId = await createEvent();
		const requested = await unresolved(await createDeck(eventId, await createPlayer(eventId)));
		const otherDeck = await createDeck(otherEventId, await createPlayer(otherEventId));
		await unresolved(otherDeck);

		await resolve(eventId, requested);

		expect(await remainingUnresolved(otherDeck)).toHaveLength(1);
		expect(await deckCards(otherDeck)).toEqual([]);
	});

	it('merges into the Deck List\'s existing rows for the card, collapsing duplicates into the earliest', async () => {
		const eventId = await createEvent();
		const deckId = await createDeck(eventId, await createPlayer(eventId));
		const boltId = await catalogueCard('Lightning Bolt');
		await db.insert(schema.playerDeckCards).values([
			{
				deckId,
				cardId: boltId,
				quantity: 2,
				compartment: 'mainboard',
				sortOrder: 5,
			},
			{
				deckId,
				cardId: boltId,
				quantity: 1,
				compartment: 'mainboard',
				sortOrder: 9,
			},
		]);
		const requested = await unresolved(deckId, { quantity: 1, sortOrder: 3 });
		await unresolved(deckId, { quantity: 2, sortOrder: 7 });

		await resolve(eventId, requested);

		expect(await deckCards(deckId)).toEqual([
			{
				name: 'Lightning Bolt',
				quantity: 6,
				compartment: 'mainboard',
				sortOrder: 3,
			},
		]);
	});
});

describe('resolving an unresolved companion entry', () => {
	it('records the imported companion for the Deck List', async () => {
		const eventId = await createEvent();
		const deckId = await createDeck(eventId, await createPlayer(eventId));
		const requested = await unresolved(deckId, { entryType: 'companion', compartment: null });

		await resolve(eventId, requested);

		const [companion] = await db.select().from(schema.playerDeckCompanions).where(eq(schema.playerDeckCompanions.deckId, deckId));
		expect(companion).toMatchObject({ source: 'melee', companionCardId: await catalogueCard('Lightning Bolt') });
		expect(await remainingUnresolved(deckId)).toEqual([]);
	});

	it('keeps a companion the operator chose by hand', async () => {
		const eventId = await createEvent();
		const deckId = await createDeck(eventId, await createPlayer(eventId));
		const manual = await catalogueCard('Lurrus of the Dream-Den');
		await db.insert(schema.playerDeckCompanions).values({ deckId, companionCardId: manual, source: 'manual' });
		const requested = await unresolved(deckId, { entryType: 'companion', compartment: null });

		await resolve(eventId, requested);

		const [companion] = await db.select().from(schema.playerDeckCompanions).where(eq(schema.playerDeckCompanions.deckId, deckId));
		expect(companion).toMatchObject({ source: 'manual', companionCardId: manual });
		expect(await remainingUnresolved(deckId)).toEqual([]);
	});

	it('refuses with a 400 and writes nothing when the sideboard has no room for it', async () => {
		const eventId = await createEvent();
		const deckId = await createDeck(eventId, await createPlayer(eventId));
		await db.insert(schema.playerDeckCards).values({
			deckId,
			cardId: await catalogueCard('Mystical Dispute'),
			quantity: 15,
			compartment: 'sideboard',
			sortOrder: 0,
		});
		const requested = await unresolved(deckId, { entryType: 'companion', compartment: null });

		await expect(resolve(eventId, requested)).rejects.toMatchObject({
			statusCode: 400,
			message: 'Imported companion requires an open sideboard slot or an existing sideboard copy.',
		});

		expect(await remainingUnresolved(deckId)).toHaveLength(1);
		expect(playerDeckCardsResolved).not.toHaveBeenCalled();
	});
});

describe('when the card provider cannot answer', () => {
	it('refuses with a 502 and a retry-after, keeping the provider\'s body private and writing nothing', async () => {
		const eventId = await createEvent();
		const deckId = await createDeck(eventId, await createPlayer(eventId));
		const requested = await unresolved(deckId);
		fetchScryfallCardById.mockRejectedValue({ code: 'SCRYFALL_UPSTREAM_FAILURE', notFound: false, message: 'private upstream response body' });

		const refusal = await refusalFrom(resolve(eventId, requested));

		expect(refusal.statusCode).toBe(502);
		expect(refusal.message).toBe('Card data provider is temporarily unavailable. Try again later.');
		expect(setResponseHeader).toHaveBeenCalledWith(requestEvent, 'retry-after', 5);
		expect(await remainingUnresolved(deckId)).toHaveLength(1);
	});

	it('refuses a card id the provider does not have with a 400, and no retry-after since waiting will not help', async () => {
		const eventId = await createEvent();
		const requested = await unresolved(await createDeck(eventId, await createPlayer(eventId)));
		fetchScryfallCardById.mockRejectedValue({ code: 'SCRYFALL_UPSTREAM_FAILURE', notFound: true });

		await expect(resolve(eventId, requested)).rejects.toMatchObject({ statusCode: 400, message: 'The selected Scryfall card was not found' });
		expect(setResponseHeader).not.toHaveBeenCalled();
	});
});

it('refuses an entry another Event owns with a 404', async () => {
	const eventId = await createEvent();
	const otherEventId = await createEvent();
	const foreign = await unresolved(await createDeck(otherEventId, await createPlayer(otherEventId)));

	await expect(resolve(eventId, foreign)).rejects.toMatchObject({ statusCode: 404 });
	expect(fetchScryfallCardById).not.toHaveBeenCalled();
});

it('refuses an Event that does not exist with a 404', async () => {
	await expect(resolve(999_999, 1)).rejects.toMatchObject({ statusCode: 404, message: 'Event not found' });
	expect(fetchScryfallCardById).not.toHaveBeenCalled();
});
