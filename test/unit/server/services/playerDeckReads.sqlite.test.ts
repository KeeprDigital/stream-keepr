import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// What the Deck List reads answer over real SQL: a Player's decks with their
// Phases and cards, the companion and the sideboard slot it takes, and the
// unresolved entries a sync left — each showing a reviewed Archetype's name.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { playerDeckCardService } = await import('~~/server/services/playerDeckCard');
const { playerDeckCompanionService, validateImportedCompanionSnapshot } = await import('~~/server/services/playerDeckCompanion');
const { playerDeckUnresolvedCardService } = await import('~~/server/services/playerDeckUnresolvedCard');

let eventId: number;
let playerId: number;
let bolt: typeof schema.cards.$inferSelect;
let lutri: typeof schema.cards.$inferSelect;
let archetypeId: number;

beforeAll(async () => {
	const [event] = await db.insert(schema.events).values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' }).returning();
	eventId = event!.id;
	[bolt, lutri] = await db.insert(schema.cards).values([
		{ name: 'Lightning Bolt', game: 'mtg', cardType: 'Instant' },
		{ name: 'Lutri, the Spellchaser', game: 'mtg' },
	]).returning() as [typeof bolt, typeof lutri];
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Jeskai Control', colors: 'WUR' }).returning();
	archetypeId = archetype!.id;
	await db.insert(schema.phases).values({ eventId, name: 'Swiss', formatExternalId: 'modern' });
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Marcus' }).returning();
	playerId = player!.id;
});

afterAll(async () => await harness.close());

async function stageDeck(values: Partial<typeof schema.playerDecks.$inferInsert> & { name: string }, sideboard = 0) {
	const [deck] = await db.insert(schema.playerDecks).values({
		eventId,
		playerId,
		externalId: values.name,
		externalSource: 'melee',
		formatExternalId: 'modern',
		colors: 'R',
		...values,
	}).returning();
	await db.insert(schema.playerDeckCards).values({
		deckId: deck!.id,
		cardId: bolt.id,
		quantity: 4,
		compartment: 'mainboard',
		sortOrder: 0,
	});
	if (sideboard > 0) {
		await db.insert(schema.playerDeckCards).values({
			deckId: deck!.id,
			cardId: bolt.id,
			quantity: sideboard,
			compartment: 'sideboard',
			sortOrder: 1,
		});
	}
	return deck!;
}

describe('playerDeckCardService.getPlayerDecks', () => {
	it('answers nothing for a Player without decks', async () => {
		const [other] = await db.insert(schema.players).values({ eventId, name: 'Deckless' }).returning();

		expect(await playerDeckCardService().getPlayerDecks(eventId, other!.id)).toEqual({ decks: [], selectedDeckId: null });
	});

	it('answers each deck with its Phases and cards, a reviewed one under its Archetype, and selects the primary', async () => {
		const reviewedAt = new Date('2026-07-15T00:00:00Z');
		const primary = await stageDeck({
			name: 'Imported Burn',
			isPrimary: true,
			archetypeId,
			reviewedAt,
		});

		const result = await playerDeckCardService().getPlayerDecks(eventId, playerId);

		expect(result.selectedDeckId).toBe(primary.id);
		expect(result.decks[0]).toMatchObject({
			id: primary.id,
			formatExternalId: 'modern',
			phaseName: 'Swiss',
			name: 'Jeskai Control',
			colors: 'WUR',
			submittedName: 'Imported Burn',
			submittedColors: 'R',
			isPrimary: true,
		});
		expect(result.decks[0]!.cards[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 4 });
	});
});

describe('companions', () => {
	it('sets a manual companion into a spare sideboard slot', async () => {
		const deck = await stageDeck({ name: 'Spare Slot' }, 10);

		expect(await playerDeckCompanionService().setManualCompanion(deck.id, lutri))
			.toEqual(expect.objectContaining({
				cardId: lutri.id,
				name: lutri.name,
				source: 'manual',
				usesExistingSideboardSlot: false,
			}));
		expect(await playerDeckCompanionService().getDeckCompanion(deck.id)).toMatchObject({ cardId: lutri.id });
	});

	it('takes an imported companion only into an open slot or onto an existing copy', () => {
		const fullSideboard = [
			{ cardId: 10, quantity: 15, compartment: 'sideboard' as const },
		];

		expect(() => validateImportedCompanionSnapshot(fullSideboard, 99)).toThrow('Imported companion requires an open sideboard slot or an existing sideboard copy.');
		expect(() => validateImportedCompanionSnapshot(fullSideboard, 10)).not.toThrow();
	});
});

describe('playerDeckUnresolvedCardService', () => {
	it('lists unresolved entries with their deck, its Phase and a reviewed Archetype\'s name, and finds them by normalized identity', async () => {
		const deck = await stageDeck({
			name: 'Unresolved Burn',
			archetypeId,
			reviewedAt: new Date(),
		});
		await db.insert(schema.playerDeckUnresolvedCards).values([
			{
				deckId: deck.id,
				entryType: 'card',
				originalName: 'Lightnng Bolt',
				normalizedOriginalName: 'lightnng bolt',
				setCode: 'M11',
				normalizedSetCode: 'm11',
				quantity: 4,
				compartment: 'mainboard',
			},
			{
				deckId: deck.id,
				entryType: 'card',
				originalName: 'Other',
				normalizedOriginalName: 'other',
				quantity: 1,
				compartment: 'mainboard',
			},
		]);

		const listed = await playerDeckUnresolvedCardService().listByEventId(eventId);
		const matching = await playerDeckUnresolvedCardService().listMatchingEntries(eventId, 'lightnng bolt', 'm11', 'card');

		expect(listed.find(entry => entry.originalName === 'Lightnng Bolt')).toMatchObject({
			playerName: 'Marcus',
			deckId: deck.id,
			deckName: 'Jeskai Control',
			phaseName: 'Swiss',
			quantity: 4,
		});
		expect(matching.map(entry => entry.originalName)).toEqual(['Lightnng Bolt']);
	});
});
