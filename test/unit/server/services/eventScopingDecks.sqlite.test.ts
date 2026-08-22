import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Cross-Event scoping proofs for the deck services (#468): Player Decks, the
 * deck-card projection, and unresolved deck cards.
 *
 * The deck tables downstream of `player_decks` (cards, unresolved cards,
 * companions) carry no event_id of their own — their Event scope exists only
 * through a join or subquery on the owning deck. Two Events therefore hold
 * decks with the identical Melee external id and identically-normalized
 * unresolved card names, so any read or Melee-sync write whose deck-resolution
 * subquery loses its Event predicate lands on the other Event's rows.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('hub:db', () => ({ db }));

const { playerDeckService } = await import('~~/server/services/playerDeck');
const { playerDeckCardService } = await import('~~/server/services/playerDeckCard');
const { playerDeckUnresolvedCardService } = await import('~~/server/services/playerDeckUnresolvedCard');

interface SeededEvent {
	eventId: number;
	playerId: number;
	archetypeId: number;
	phaseId: number;
	roundId: number;
	deckId: number;
	unresolvedCardId: number;
}

let cardId: number;

async function seedEvent(name: string): Promise<SeededEvent> {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;

	const [player] = await db.insert(schema.players)
		.values({ eventId, name: `${name} Player` })
		.returning({ id: schema.players.id });
	const [archetype] = await db.insert(schema.archetypes)
		.values({ eventId, name: 'Shared Archetype' })
		.returning({ id: schema.archetypes.id });
	const [phase] = await db.insert(schema.phases)
		.values({ eventId, name: `${name} Swiss`, formatExternalId: 'format-shared' })
		.returning({ id: schema.phases.id });
	const [round] = await db.insert(schema.rounds)
		.values({ eventId, phaseId: phase!.id, name: 'Round 1', roundNumber: 1 })
		.returning({ id: schema.rounds.id });
	const [deck] = await db.insert(schema.playerDecks)
		.values({
			eventId,
			playerId: player!.id,
			externalId: 'deck-shared',
			externalSource: 'melee',
			formatExternalId: 'format-shared',
			name: `${name} Deck`,
			isPrimary: true,
			archetypeId: archetype!.id,
		})
		.returning({ id: schema.playerDecks.id });
	await db.insert(schema.playerDeckCards)
		.values({ deckId: deck!.id, cardId, quantity: 4, compartment: 'mainboard', sortOrder: 0 });
	await db.insert(schema.playerDeckCompanions)
		.values({ deckId: deck!.id, companionCardId: cardId, source: 'melee' });
	const [unresolved] = await db.insert(schema.playerDeckUnresolvedCards)
		.values({
			deckId: deck!.id,
			entryType: 'card',
			originalName: 'Brainstorm',
			normalizedOriginalName: 'brainstorm',
			quantity: 2,
			compartment: 'mainboard',
		})
		.returning({ id: schema.playerDeckUnresolvedCards.id });

	return {
		eventId,
		playerId: player!.id,
		archetypeId: archetype!.id,
		phaseId: phase!.id,
		roundId: round!.id,
		deckId: deck!.id,
		unresolvedCardId: unresolved!.id,
	};
}

let one: SeededEvent;
let two: SeededEvent;

beforeAll(async () => {
	const [card] = await db.insert(schema.cards)
		.values({ name: 'Ragavan, Nimble Pilferer', game: 'mtg' })
		.returning({ id: schema.cards.id });
	cardId = card!.id;
	one = await seedEvent('Event One');
	two = await seedEvent('Event Two');
});

afterAll(async () => await harness.close());

describe('playerDeckService event scoping', () => {
	it('deck listings stay inside the asking Event', async () => {
		const service = playerDeckService();
		expect((await service.listByEvent(one.eventId)).map(deck => deck.id)).toEqual([one.deckId]);
		expect(await service.listByPlayer(one.eventId, two.playerId)).toEqual([]);
		expect(await service.findManyByIds(one.eventId, [two.deckId])).toEqual([]);
	});

	it('archetype-keyed listings stay inside the asking Event', async () => {
		const service = playerDeckService();
		expect(await service.listPlayerIdsByArchetype(one.eventId, two.archetypeId)).toEqual([]);
		expect(await service.listPrimaryPlayerIdsByArchetype(one.eventId, two.archetypeId)).toEqual([]);
	});

	it('format resolution refuses another Event\'s Phase and Round ids', async () => {
		// A player whose primary deck is in a format of its own, plus a second
		// deck in the format both Events share. A selection naming the other
		// Event's Phase or Round must fall back to the primary deck; resolving
		// the foreign row's format would pick the shared-format deck instead.
		const [player] = await db.insert(schema.players)
			.values({ eventId: two.eventId, name: 'Selector' })
			.returning({ id: schema.players.id });
		await db.insert(schema.playerDecks).values([
			{
				eventId: two.eventId,
				playerId: player!.id,
				externalId: 'selector-primary',
				externalSource: 'melee',
				formatExternalId: 'format-other',
				name: 'Primary',
				isPrimary: true,
			},
			{
				eventId: two.eventId,
				playerId: player!.id,
				externalId: 'selector-secondary',
				externalSource: 'melee',
				formatExternalId: 'format-shared',
				name: 'Secondary',
				isPrimary: false,
			},
		]);

		const service = playerDeckService();
		const decks = await service.listByPlayer(two.eventId, player!.id);
		expect((await service.selectFromDecks(two.eventId, decks, { phaseId: two.phaseId }))?.name).toBe('Secondary');
		expect((await service.selectFromDecks(two.eventId, decks, { phaseId: one.phaseId }))?.name).toBe('Primary');
		expect((await service.selectFromDecks(two.eventId, decks, { roundId: two.roundId }))?.name).toBe('Secondary');
		expect((await service.selectFromDecks(two.eventId, decks, { roundId: one.roundId }))?.name).toBe('Primary');
	});

	it('review and reconcile refuse another Event\'s rows', async () => {
		const service = playerDeckService();
		expect(await service.reviewDeck(one.eventId, two.playerId, two.deckId, one.archetypeId)).toBeNull();
		expect(await service.reconcilePrimaryArchetype(one.eventId, two.playerId)).toBeNull();
	});

	it('replaceMeleeDecksForEvent never touches the other Event\'s colliding deck', async () => {
		// Replace Event 1's decks for its player: the shared external id gets a
		// new name, a fresh card list, and its imported companion cleared.
		await playerDeckService().replaceMeleeDecksForEvent(one.eventId, [{
			playerId: one.playerId,
			snapshots: [{
				deck: {
					eventId: one.eventId,
					playerId: one.playerId,
					externalId: 'deck-shared',
					formatExternalId: 'format-shared',
					name: 'Event One Deck v2',
					colors: 'R',
					sortOrder: 0,
					isPrimary: true,
				},
				cards: [{ cardId, quantity: 1, compartment: 'sideboard', sortOrder: 0 }],
				unresolvedCards: [{
					entryType: 'card',
					originalName: 'Counterspell',
					normalizedOriginalName: 'counterspell',
					quantity: 3,
					compartment: 'mainboard',
				}],
				importedCompanion: { action: 'clear' },
			}],
		}]);

		// Event 1's copy was rewritten in place…
		const [deckOne] = await playerDeckService().findManyByIds(one.eventId, [one.deckId]);
		expect(deckOne?.name).toBe('Event One Deck v2');
		const cardsOne = await db.select().from(schema.playerDeckCards).where(eq(schema.playerDeckCards.deckId, one.deckId));
		expect(cardsOne).toMatchObject([{ quantity: 1, compartment: 'sideboard' }]);
		const companionsOne = await db.select().from(schema.playerDeckCompanions).where(eq(schema.playerDeckCompanions.deckId, one.deckId));
		expect(companionsOne).toEqual([]);

		// …and Event 2's deck under the same external id kept everything.
		const [deckTwo] = await playerDeckService().findManyByIds(two.eventId, [two.deckId]);
		expect(deckTwo?.name).toBe('Event Two Deck');
		const cardsTwo = await db.select().from(schema.playerDeckCards).where(eq(schema.playerDeckCards.deckId, two.deckId));
		expect(cardsTwo).toMatchObject([{ quantity: 4, compartment: 'mainboard' }]);
		const companionsTwo = await db.select().from(schema.playerDeckCompanions).where(eq(schema.playerDeckCompanions.deckId, two.deckId));
		expect(companionsTwo).toMatchObject([{ companionCardId: cardId, source: 'melee' }]);
		const unresolvedTwo = await db.select().from(schema.playerDeckUnresolvedCards).where(eq(schema.playerDeckUnresolvedCards.deckId, two.deckId));
		expect(unresolvedTwo).toMatchObject([{ normalizedOriginalName: 'brainstorm' }]);
	});
});

describe('playerDeckCardService event scoping', () => {
	it('a foreign player id resolves to no decks at all', async () => {
		const collection = await playerDeckCardService().getPlayerDecks(one.eventId, two.playerId);
		expect(collection).toEqual({ decks: [], selectedDeckId: null });
	});

	it('phase names come from the asking Event despite a shared format id', async () => {
		const collection = await playerDeckCardService().getPlayerDecks(two.eventId, two.playerId);
		expect(collection.decks.map(deck => deck.id)).toEqual([two.deckId]);
		expect(collection.decks[0]?.phaseIds).toEqual([two.phaseId]);
		expect(collection.decks[0]?.phaseName).toBe('Event Two Swiss');
	});
});

describe('playerDeckUnresolvedCardService event scoping', () => {
	it('listByEventId stays inside the asking Event', async () => {
		const entries = await playerDeckUnresolvedCardService().listByEventId(two.eventId);
		expect(entries.map(entry => entry.id)).toEqual([two.unresolvedCardId]);
		expect(entries[0]?.eventId).toBe(two.eventId);
	});

	it('findById with the wrong Event finds nothing', async () => {
		expect(await playerDeckUnresolvedCardService().findById(two.unresolvedCardId, one.eventId)).toBeUndefined();
	});

	it('matching entries for a shared normalized name stay inside the asking Event', async () => {
		const entries = await playerDeckUnresolvedCardService().listMatchingEntries(two.eventId, 'brainstorm', '', 'card');
		expect(entries.map(entry => entry.id)).toEqual([two.unresolvedCardId]);
	});
});
