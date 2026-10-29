import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Card breakdown, token requirements, summary and Archetype detail over real
// SQL. Only primary decks count, and basic lands never appear as cards.
//
// Four Players hold primary decks; p1 also holds a non-primary deck (Wrath).
//   d1 p1 Mono Red (reviewed)   main: Mountain 20, Bolt 4, Shatterskull 2 | side: Stroke 2
//   d2 p2 Mono Red (unreviewed) main: Mountain 20, Bolt 2, Treasure Vault 2 | side: Bolt 2, Stroke 2
//   d3 p3 unclassified          main: Negate 3, Fable 1
//   d4 p4 unclassified          main: Negate 3, Reflection Spell 1, Surveyor Saga 1
// p5 is Mono Red with no deck at all.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { metagameReadModel } = await import('~~/server/modules/metagame/readModel');

function token(id: string, name: string): DeckTokenRequirement {
	return {
		id,
		scryfallId: id,
		name,
		typeLine: `Token - ${name}`,
		uri: null,
	};
}

let eventId: number;
let emptyEventId: number;
let monoRedId: number;
const playerIds: number[] = [];

beforeAll(async () => {
	const [event, empty] = await db.insert(schema.events)
		.values([
			{ name: 'Metagame', game: 'mtg', featureMatchOrientation: 'horizontal' },
			{ name: 'Empty', game: 'mtg', featureMatchOrientation: 'horizontal' },
		])
		.returning({ id: schema.events.id });
	eventId = event!.id;
	emptyEventId = empty!.id;

	const [monoRed] = await db.insert(schema.archetypes)
		.values([
			{ eventId, name: 'Mono Red', colors: 'R' },
			{ eventId, name: 'Unplayed' },
		])
		.returning({ id: schema.archetypes.id });
	monoRedId = monoRed!.id;

	const cardRows = await db.insert(schema.cards)
		.values([
			{ name: 'Mountain', cardType: 'Basic Land' },
			{ name: 'Lightning Bolt', cardType: 'Instant' },
			{ name: 'Shatterskull Smashing', cardType: 'Sorcery // Land' },
			{ name: 'Treasure Vault', cardType: 'Artifact Land' },
			{ name: 'Disdainful Stroke', cardType: 'Instant' },
			{ name: 'Negate', cardType: 'Instant' },
			{
				name: 'Fable of the Mirror-Breaker',
				cardType: 'Enchantment',
				deckTokens: [
					token('token-a', 'Map'),
				],
			},
			{
				name: 'Reflection Spell',
				cardType: 'Sorcery',
				deckTokens: [
					token('token-b', 'Reflection'),
					token('token-a', 'Map'),
				],
			},
			{
				name: 'Surveyor Saga',
				cardType: 'Enchantment',
				deckTokens: [
					token('token-a-copy', ' map '),
				],
			},
			{ name: 'Wrath of God', cardType: 'Sorcery' },
		].map(card => ({ game: 'mtg' as const, ...card })))
		.returning({ id: schema.cards.id, name: schema.cards.name });
	const card = (name: string) => cardRows.find(row => row.name === name)!.id;

	const playerRows = await db.insert(schema.players)
		.values([
			{
				eventId,
				name: 'p1',
				archetypeId: monoRedId,
				position: 1,
				wins: 4,
				losses: 2,
				points: 12,
			},
			{
				eventId,
				name: 'p2',
				archetypeId: monoRedId,
				position: 2,
				wins: 3,
				losses: 3,
				points: 9,
			},
			{
				eventId,
				name: 'p3',
				position: 3,
				wins: 2,
				losses: 4,
				points: 6,
			},
			{
				eventId,
				name: 'p4',
				position: 4,
				wins: 1,
				losses: 5,
				points: 3,
			},
			{ eventId, name: 'p5', archetypeId: monoRedId },
		])
		.returning({ id: schema.players.id });
	playerIds.push(...playerRows.map(row => row.id));

	const decks: { player: number; name: string; primary: boolean; reviewed?: boolean; cards: [string, number, 'mainboard' | 'sideboard'][] }[] = [
		{
			player: 0,
			name: 'Red Deck Wins',
			primary: true,
			reviewed: true,
			cards: [
				['Mountain', 20, 'mainboard'],
				['Lightning Bolt', 4, 'mainboard'],
				['Shatterskull Smashing', 2, 'mainboard'],
				['Disdainful Stroke', 2, 'sideboard'],
			],
		},
		{
			player: 1,
			name: 'Boros Burn',
			primary: true,
			cards: [
				['Mountain', 20, 'mainboard'],
				['Lightning Bolt', 2, 'mainboard'],
				['Treasure Vault', 2, 'mainboard'],
				['Lightning Bolt', 2, 'sideboard'],
				['Disdainful Stroke', 2, 'sideboard'],
			],
		},
		{
			player: 2,
			name: 'Izzet',
			primary: true,
			cards: [
				['Negate', 3, 'mainboard'],
				['Fable of the Mirror-Breaker', 1, 'mainboard'],
			],
		},
		{
			player: 3,
			name: 'Tokens',
			primary: true,
			cards: [
				['Negate', 3, 'mainboard'],
				['Reflection Spell', 1, 'mainboard'],
				['Surveyor Saga', 1, 'mainboard'],
			],
		},
		{
			player: 0,
			name: 'Old List',
			primary: false,
			cards: [
				['Wrath of God', 4, 'mainboard'],
			],
		},
	];
	for (const [index, deck] of decks.entries()) {
		const [row] = await db.insert(schema.playerDecks)
			.values({
				eventId,
				playerId: playerIds[deck.player]!,
				externalId: `deck-${index}`,
				externalSource: 'melee',
				formatExternalId: 'format',
				name: deck.name,
				isPrimary: deck.primary,
				archetypeId: deck.reviewed ? monoRedId : null,
				reviewedAt: deck.reviewed
					? new Date('2026-09-01T00:00:00Z')
					: null,
			})
			.returning({ id: schema.playerDecks.id });
		await db.insert(schema.playerDeckCards).values(deck.cards.map(([name, quantity, compartment], sortOrder) => ({
			deckId: row!.id,
			cardId: card(name),
			quantity,
			compartment,
			sortOrder,
		})));
	}
});

afterAll(async () => await harness.close());

const names = (entries: { name: string }[]) => entries.map(entry => entry.name).toSorted();

describe('card breakdown', () => {
	it('counts primary decks only and leaves basic lands out, keeping nonbasic lands and land-backed spells', async () => {
		const result = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all' });

		expect(result.totalDecks).toBe(4);
		expect(names(result.entries)).toEqual([
			'Disdainful Stroke',
			'Fable of the Mirror-Breaker',
			'Lightning Bolt',
			'Negate',
			'Reflection Spell',
			'Shatterskull Smashing',
			'Surveyor Saga',
			'Treasure Vault',
		]);
		expect(result.entries.find(entry => entry.name === 'Lightning Bolt')).toMatchObject({
			totalCopies: 8,
			deckCount: 2,
			avgCopies: 4,
			inclusionRate: 50,
			mainboardCount: 6,
			sideboardCount: 2,
		});
	});

	it('recomputes metrics from the chosen board before sorting', async () => {
		const mainboard = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all', board: 'mainboard', sortBy: 'totalCopies' });
		const sideboard = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all', board: 'sideboard', sortBy: 'totalCopies' });

		expect(mainboard.entries.map(entry => entry.name).slice(0, 2)).toEqual(['Lightning Bolt', 'Negate']);
		expect(mainboard.entries[0]).toMatchObject({
			totalCopies: 6,
			deckCount: 2,
			avgCopies: 3,
			inclusionRate: 50,
		});
		expect(names(mainboard.entries)).not.toContain('Disdainful Stroke');
		expect(sideboard.entries.map(entry => [entry.name, entry.totalCopies, entry.deckCount])).toEqual([
			['Disdainful Stroke', 4, 2],
			['Lightning Bolt', 2, 1],
		]);
	});

	it('sorts by the selected metric and honours the limit', async () => {
		const byAverage = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all', sortBy: 'avgCopies' });
		const limited = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all', limit: 1 });

		expect(byAverage.entries[0]!.name).toBe('Lightning Bolt');
		expect(limited.entries).toHaveLength(1);
	});

	it('narrows to the scoped Players\' decks', async () => {
		const topTwo = await metagameReadModel().getCardBreakdown(eventId, { scope: 'topN', topN: 2 });

		expect(topTwo.totalDecks).toBe(2);
		expect(names(topTwo.entries)).not.toContain('Negate');
	});

	it('answers an Event without decks with nothing', async () => {
		expect(await metagameReadModel().getCardBreakdown(emptyEventId, { scope: 'all' }))
			.toMatchObject({ entries: [], totalDecks: 0, scope: 'all' });
	});
});

describe('pointed cards', () => {
	// A 7PH Event: q1 plays Demonic Tutor and Tolarian Academy, q2 Snapcaster Mage and a sideboard
	// Lurrus, which only a declared companion points. Both play Counterspell.
	let pointedEventId: number;

	beforeAll(async () => {
		const [event] = await db.insert(schema.events)
			.values({
				name: 'Pointed',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
				pointsSystem: '7ph',
			})
			.returning({ id: schema.events.id });
		pointedEventId = event!.id;

		const cardRows = await db.insert(schema.cards)
			.values([
				{ name: 'Demonic Tutor', cardType: 'Sorcery', oracleId: '82004860-e589-4e38-8d61-8c0210e4ea39' },
				{ name: 'Tolarian Academy', cardType: 'Legendary Land', oracleId: 'dba4fd31-8931-42dd-bd86-45479c2abf74' },
				{ name: 'Snapcaster Mage', cardType: 'Creature', oracleId: '2bb2eda7-3b38-4c56-870f-c3218a1056f5' },
				{ name: 'Lurrus of the Dream-Den', cardType: 'Creature', oracleId: '3bc757c1-3adb-4321-8832-8e1cc9e687f7' },
				{ name: 'Counterspell', cardType: 'Instant', oracleId: 'counterspell-oracle' },
			].map(card => ({ game: 'mtg' as const, ...card })))
			.returning({ id: schema.cards.id, name: schema.cards.name });
		const card = (name: string) => cardRows.find(row => row.name === name)!.id;

		const decks: [string, [string, number, 'mainboard' | 'sideboard'][]][] = [
			[
				'q1',
				[
					['Demonic Tutor', 1, 'mainboard'],
					['Tolarian Academy', 1, 'mainboard'],
					['Counterspell', 4, 'mainboard'],
				],
			],
			[
				'q2',
				[
					['Snapcaster Mage', 1, 'mainboard'],
					['Counterspell', 4, 'mainboard'],
					['Lurrus of the Dream-Den', 1, 'sideboard'],
				],
			],
		];
		for (const [index, [name, deckCards]] of decks.entries()) {
			const [player] = await db.insert(schema.players)
				.values({ eventId: pointedEventId, name, position: index + 1 })
				.returning({ id: schema.players.id });
			const [deck] = await db.insert(schema.playerDecks)
				.values({
					eventId: pointedEventId,
					playerId: player!.id,
					externalId: `pointed-${index}`,
					externalSource: 'melee',
					formatExternalId: 'format',
					name: 'Deck',
					isPrimary: true,
				})
				.returning({ id: schema.playerDecks.id });
			await db.insert(schema.playerDeckCards).values(deckCards.map(([cardName, quantity, compartment], sortOrder) => ({
				deckId: deck!.id,
				cardId: card(cardName),
				quantity,
				compartment,
				sortOrder,
			})));
		}
	});

	it('gives each card its points under the Event\'s points system, and none to cards it does not point', async () => {
		const result = await metagameReadModel().getCardBreakdown(pointedEventId, { scope: 'all' });

		expect(result.entries.map(entry => [entry.name, entry.highlanderPoints]).toSorted()).toEqual([
			['Counterspell', null],
			['Demonic Tutor', 2],
			['Lurrus of the Dream-Den', null],
			['Snapcaster Mage', 1],
			['Tolarian Academy', 2],
		]);
	});

	it('keeps only pointed cards before the limit applies', async () => {
		const result = await metagameReadModel().getCardBreakdown(pointedEventId, { scope: 'all', pointedOnly: true, limit: 2 });

		expect(result.entries.map(entry => entry.name)).toEqual(['Demonic Tutor', 'Snapcaster Mage']);
	});

	it('leaves points off an Event without a points system, where no card is pointed', async () => {
		const all = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all' });
		const pointed = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all', pointedOnly: true });

		expect(all.entries.some(entry => 'highlanderPoints' in entry)).toBe(false);
		expect(pointed.entries).toEqual([]);
	});
});

describe('token requirements', () => {
	it('merges tokens by trimmed, case-insensitive name and counts distinct decks and source cards', async () => {
		const result = await metagameReadModel().getTokenRequirements(eventId, { scope: 'all' });

		expect(result.totalDecks).toBe(4);
		expect(result.entries.map(entry => [entry.name, entry.deckCount, entry.sourceCardCount])).toEqual([
			['Map', 2, 3],
			['Reflection', 1, 1],
		]);
		expect(result.entries[0]!.sourceCards.map(card => card.name)).toEqual([
			'Fable of the Mirror-Breaker',
			'Reflection Spell',
			'Surveyor Saga',
		]);
	});

	it('answers no tokens for a scope whose decks need none', async () => {
		expect(await metagameReadModel().getTokenRequirements(eventId, { scope: 'topN', topN: 2 }))
			.toEqual({ entries: [], totalDecks: 2, scope: 'topN' });
	});
});

describe('summary', () => {
	it('reports the Event\'s counts and leaves basic lands out of the top cards', async () => {
		const result = await metagameReadModel().getSummary(eventId, { scope: 'all' });

		expect(result).toMatchObject({
			totalPlayers: 5,
			classifiedPlayers: 3,
			totalDecks: 4,
			totalArchetypes: 2,
			scopedArchetypeCount: 1,
			scope: 'all',
		});
		expect(result.topCards.map(entry => entry.name)).not.toContain('Mountain');
		expect(result.facts).toEqual(expect.arrayContaining([
			expect.objectContaining({ key: 'mostPlayedCards' }),
		]));
	});
});

describe('archetype detail', () => {
	it('names each Player\'s deck by the reviewed Archetype, the submitted deck, or nothing', async () => {
		const detail = await metagameReadModel().getArchetypeDetail(eventId, { scope: 'all', archetypeId: monoRedId });

		expect(detail?.players.map(player => [player.name, player.deckName])).toEqual(expect.arrayContaining([
			['p1', 'Mono Red'],
			['p2', 'Boros Burn'],
			['p5', null],
		]));
		expect(detail?.playerCount).toBe(3);
	});
});
