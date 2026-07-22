import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

// ── Mocks ──

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	players: {
		id: 'players.id',
		eventId: 'players.eventId',
		archetypeId: 'players.archetypeId',
		position: 'players.position',
		wins: 'players.wins',
		losses: 'players.losses',
		draws: 'players.draws',
		points: 'players.points',
		gameData: 'players.gameData',
		name: 'players.name',
	},
	archetypes: {
		id: 'archetypes.id',
		eventId: 'archetypes.eventId',
		name: 'archetypes.name',
		colors: 'archetypes.colors',
	},
	cards: {
		id: 'cards.id',
		name: 'cards.name',
		game: 'cards.game',
		scryfallId: 'cards.scryfallId',
		oracleId: 'cards.oracleId',
		cardType: 'cards.cardType',
		colors: 'cards.colors',
		cmc: 'cards.cmc',
		manaCost: 'cards.manaCost',
		deckTokens: 'cards.deckTokens',
	},
	playerDeckCards: {
		id: 'player_deck_cards.id',
		deckId: 'player_deck_cards.deck_id',
		cardId: 'player_deck_cards.card_id',
		quantity: 'player_deck_cards.quantity',
		compartment: 'player_deck_cards.compartment',
		sortOrder: 'player_deck_cards.sort_order',
	},
	playerDecks: {
		id: 'player_decks.id',
		eventId: 'player_decks.event_id',
		playerId: 'player_decks.player_id',
		isPrimary: 'player_decks.is_primary',
	},
	archetypeCards: {
		id: 'archetype_cards.id',
		archetypeId: 'archetype_cards.archetype_id',
		cardId: 'archetype_cards.card_id',
		sortOrder: 'archetype_cards.sort_order',
	},
}));

// alias() from drizzle-orm/sqlite-core just returns the table object in tests
vi.mock('drizzle-orm/sqlite-core', () => ({
	alias: (_table: unknown, _name: string) => _table,
}));

const mockGetMemberPlayerIds = vi.fn();
vi.mock('~~/server/services/playerList', () => ({
	playerListService: () => ({ getMemberPlayerIds: mockGetMemberPlayerIds }),
}));

const mockGetKeyCardsByArchetypeIds = vi.fn();
const mockGetKeyCards = vi.fn();
vi.mock('~~/server/services/archetypeCard', () => ({
	archetypeCardService: () => ({
		getKeyCardsByArchetypeIds: mockGetKeyCardsByArchetypeIds,
		getKeyCards: mockGetKeyCards,
	}),
}));

const { createMetagameReadModelImplementation } = await import('~~/server/modules/metagame/readModelImplementation');
const metagameService = createMetagameReadModelImplementation;

// ── Chain helpers ──

/** Chain where .where() or .orderBy() is the terminal (most common) */
function makeSelectChain(resolvedValue: any[]) {
	const chain: any = {};
	const noopMethods = ['from', 'innerJoin', 'leftJoin', 'groupBy', 'having', 'limit', 'offset'];
	for (const m of noopMethods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}
	chain.where = vi.fn().mockResolvedValue(resolvedValue);
	chain.orderBy = vi.fn().mockResolvedValue(resolvedValue);
	chain.selectDistinct = vi.fn().mockResolvedValue(resolvedValue);
	return chain;
}

/** Chain where .orderBy() is terminal and .where() is a noop */
function makeOrderByChain(resolvedValue: any[]) {
	const chain: any = {};
	const noopMethods = ['from', 'innerJoin', 'leftJoin', 'groupBy', 'having', 'limit', 'offset', 'where'];
	for (const m of noopMethods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}
	chain.orderBy = vi.fn().mockResolvedValue(resolvedValue);
	return chain;
}

/** Chain where .groupBy() is terminal */
function makeGroupByChain(resolvedValue: any[]) {
	const chain: any = {};
	const noopMethods = ['from', 'innerJoin', 'leftJoin', 'having', 'offset', 'where', 'orderBy'];
	for (const m of noopMethods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}
	chain.groupBy = vi.fn().mockResolvedValue(resolvedValue);
	return chain;
}

// ── Tests ──

describe('metagameService cards and summary', () => {
	beforeEach(() => {
		resetDbMocks();
		mockGetMemberPlayerIds.mockReset();
		mockGetKeyCardsByArchetypeIds.mockReset().mockResolvedValue(new Map());
		mockGetKeyCards.mockReset().mockResolvedValue([]);
		// Wire up selectDistinct (added to mockDb in db-mock.ts)
		mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));
	});

	// ── getArchetypeBreakdown ──

	describe('getCardBreakdown', () => {
		it('returns empty response when no deck rows (scope=all)', async () => {
			// scope='all': no upfront ID select; deckCountRows (selectDistinct) → empty
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));

			const result = await metagameService().getCardBreakdown(1, 'all');
			expect(result.totalDecks).toBe(0);
			expect(result.entries).toHaveLength(0);
			expect(result.scope).toBe('all');
		});

		it('returns empty response when no scoped players (scope=topN)', async () => {
			// scope='topN': IDs select returns empty → early return
			mockDb.select.mockReturnValueOnce(makeSelectChain([]));

			const result = await metagameService().getCardBreakdown(1, 'topN', 'inclusionRate', 50, 8);
			expect(result.totalDecks).toBe(0);
			expect(result.entries).toHaveLength(0);
		});

		it('with deck card rows: entries populated with correct fields', async () => {
			// scope='all': no upfront select
			// 1. aggRows (groupBy terminal)
			// selectDistinct: deckCountRows → 2 decks
			mockDb.select
				.mockReturnValueOnce(makeGroupByChain([
					{
						cardId: 1,
						name: 'Lightning Bolt',
						cardType: 'Instant',
						scryfallId: null,
						colors: 'R',
						cmc: 1,
						totalCopies: 8,
						mainboardCount: 8,
						sideboardCount: 0,
						deckCount: 2,
					},
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }, { playerId: 2 }]));

			const result = await metagameService().getCardBreakdown(1, 'all');

			expect(result.entries).toHaveLength(1);
			expect(result.totalDecks).toBe(2);
			const entry = result.entries[0];
			expect(entry.name).toBe('Lightning Bolt');
			expect(entry.inclusionRate).toBe(100);
			expect(entry.avgCopies).toBe(4);
			expect(entry.mainboardCount).toBe(8);
			expect(entry.sideboardCount).toBe(0);
			expect(entry.deckCount).toBe(2);
		});

		it('sortBy=\'avgCopies\' orders correctly', async () => {
			mockDb.select
				.mockReturnValueOnce(makeGroupByChain([
					{ cardId: 1, name: 'Bolt', cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, totalCopies: 4, mainboardCount: 4, sideboardCount: 0, mainboardDeckCount: 1, sideboardDeckCount: 0, deckCount: 1 },
					{ cardId: 2, name: 'Wrath', cardType: 'Sorcery', scryfallId: null, colors: 'W', cmc: 4, totalCopies: 2, mainboardCount: 2, sideboardCount: 0, mainboardDeckCount: 1, sideboardDeckCount: 0, deckCount: 1 },
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }]));

			const result = await metagameService().getCardBreakdown(1, 'all', 'avgCopies');

			expect(result.entries[0].name).toBe('Bolt');
		});

		it('limit=1 slices to 1 entry', async () => {
			mockDb.select
				.mockReturnValueOnce(makeGroupByChain([
					{ cardId: 1, name: 'Bolt', cardType: null, scryfallId: null, colors: 'R', cmc: 1, totalCopies: 4, mainboardCount: 4, sideboardCount: 0, mainboardDeckCount: 1, sideboardDeckCount: 0, deckCount: 1 },
					{ cardId: 2, name: 'Wrath', cardType: null, scryfallId: null, colors: 'W', cmc: 4, totalCopies: 2, mainboardCount: 2, sideboardCount: 0, mainboardDeckCount: 1, sideboardDeckCount: 0, deckCount: 1 },
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }]));

			const result = await metagameService().getCardBreakdown(1, 'all', 'inclusionRate', 1);

			expect(result.entries).toHaveLength(1);
		});

		it('excludes only basic lands while keeping nonbasic lands and spell-front MDFCs', async () => {
			mockDb.select
				.mockReturnValueOnce(makeGroupByChain([
					{ cardId: 1, name: 'Forest', cardType: 'Basic Land', scryfallId: null, colors: 'G', cmc: 0, manaCost: null, totalCopies: 24, mainboardCount: 24, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
					{ cardId: 2, name: 'Treasure Vault', cardType: 'Artifact Land', scryfallId: null, colors: null, cmc: 0, manaCost: null, totalCopies: 2, mainboardCount: 2, sideboardCount: 0, mainboardDeckCount: 1, sideboardDeckCount: 0, deckCount: 1 },
					{ cardId: 3, name: 'Lightning Bolt', cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}', totalCopies: 8, mainboardCount: 8, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
					{ cardId: 4, name: 'Shatterskull Smashing', cardType: 'Sorcery // Land', scryfallId: null, colors: 'R', cmc: 2, manaCost: '{X}{R}{R}', totalCopies: 2, mainboardCount: 2, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }, { playerId: 2 }]));

			const result = await metagameService().getCardBreakdown(1, 'all');

			expect(result.entries.map((entry: { name: string }) => entry.name)).toEqual([
				'Lightning Bolt',
				'Shatterskull Smashing',
				'Treasure Vault',
			]);
		});

		it('recomputes metrics from mainboard-only data before sorting and filtering', async () => {
			mockDb.select
				.mockReturnValueOnce(makeGroupByChain([
					{ cardId: 1, name: 'Lightning Bolt', cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}', totalCopies: 6, mainboardCount: 4, sideboardCount: 2, mainboardDeckCount: 1, sideboardDeckCount: 1, deckCount: 2 },
					{ cardId: 2, name: 'Negate', cardType: 'Instant', scryfallId: null, colors: 'U', cmc: 2, manaCost: '{1}{U}', totalCopies: 6, mainboardCount: 6, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
					{ cardId: 3, name: 'Disdainful Stroke', cardType: 'Instant', scryfallId: null, colors: 'U', cmc: 2, manaCost: '{1}{U}', totalCopies: 4, mainboardCount: 0, sideboardCount: 4, mainboardDeckCount: 0, sideboardDeckCount: 2, deckCount: 2 },
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([
				{ playerId: 1 },
				{ playerId: 2 },
				{ playerId: 3 },
				{ playerId: 4 },
			]));

			const result = await metagameService().getCardBreakdown(1, 'all', 'totalCopies', 50, undefined, undefined, undefined, 'mainboard');

			expect(result.entries.map((entry: { name: string }) => entry.name)).toEqual(['Negate', 'Lightning Bolt']);
			expect(result.entries[0]).toMatchObject({
				name: 'Negate',
				totalCopies: 6,
				deckCount: 2,
				avgCopies: 3,
				inclusionRate: 50,
				mainboardCount: 6,
				sideboardCount: 0,
			});
			expect(result.entries[1]).toMatchObject({
				name: 'Lightning Bolt',
				totalCopies: 4,
				deckCount: 1,
				avgCopies: 4,
				inclusionRate: 25,
				mainboardCount: 4,
				sideboardCount: 2,
			});
		});

		it('recomputes metrics from sideboard-only data', async () => {
			mockDb.select
				.mockReturnValueOnce(makeGroupByChain([
					{ cardId: 1, name: 'Lightning Bolt', cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}', totalCopies: 6, mainboardCount: 4, sideboardCount: 2, mainboardDeckCount: 1, sideboardDeckCount: 1, deckCount: 2 },
					{ cardId: 2, name: 'Disdainful Stroke', cardType: 'Instant', scryfallId: null, colors: 'U', cmc: 2, manaCost: '{1}{U}', totalCopies: 4, mainboardCount: 0, sideboardCount: 4, mainboardDeckCount: 0, sideboardDeckCount: 2, deckCount: 2 },
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([
				{ playerId: 1 },
				{ playerId: 2 },
				{ playerId: 3 },
				{ playerId: 4 },
			]));

			const result = await metagameService().getCardBreakdown(1, 'all', 'inclusionRate', 50, undefined, undefined, undefined, 'sideboard');

			expect(result.entries).toHaveLength(2);
			expect(result.entries[0]).toMatchObject({
				name: 'Disdainful Stroke',
				totalCopies: 4,
				deckCount: 2,
				avgCopies: 2,
				inclusionRate: 50,
			});
			expect(result.entries[1]).toMatchObject({
				name: 'Lightning Bolt',
				totalCopies: 2,
				deckCount: 1,
				avgCopies: 2,
				inclusionRate: 25,
			});
		});
	});

	describe('getTokenRequirements', () => {
		it('returns empty response when there are no scoped decks', async () => {
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));

			const result = await metagameService().getTokenRequirements(1, 'all');

			expect(result).toEqual({ entries: [], totalDecks: 0, scope: 'all' });
		});

		it('deduplicates tokens by name and counts distinct decks and source cards', async () => {
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }, { playerId: 2 }]));
			mockDb.select.mockReturnValueOnce(makeSelectChain([
				{
					deckId: 1,
					cardId: 10,
					cardName: 'Fable of the Mirror-Breaker',
					cardScryfallId: 'source-10',
					cardType: 'Enchantment',
					deckTokens: [
						{ id: 'token-a', scryfallId: 'token-a', name: 'Map', typeLine: 'Token Artifact - Map', uri: 'https://example.com/token-a' },
					],
				},
				{
					deckId: 1,
					cardId: 11,
					cardName: 'Surveyor Saga',
					cardScryfallId: 'source-11',
					cardType: 'Enchantment',
					deckTokens: [
						{ id: 'token-a-copy', scryfallId: 'token-a-copy', name: 'map', typeLine: 'Token Artifact - Map', uri: null },
					],
				},
				{
					deckId: 2,
					cardId: 12,
					cardName: 'Reflection Spell',
					cardScryfallId: 'source-12',
					cardType: 'Sorcery',
					deckTokens: [
						{ id: 'token-b', scryfallId: 'token-b', name: 'Reflection', typeLine: 'Token Creature - Reflection', uri: null },
						{ id: 'token-a', scryfallId: 'token-a', name: 'Map', typeLine: 'Token Artifact - Map', uri: 'https://example.com/token-a' },
					],
				},
			]));

			const result = await metagameService().getTokenRequirements(1, 'all');

			expect(result.totalDecks).toBe(2);
			expect(result.entries.map(entry => entry.name)).toEqual(['Map', 'Reflection']);
			expect(result.entries[0]).toMatchObject({
				name: 'Map',
				deckCount: 2,
				sourceCardCount: 3,
				scryfallId: 'token-a',
			});
			expect(result.entries[0].sourceCards.map(card => card.name)).toEqual([
				'Fable of the Mirror-Breaker',
				'Reflection Spell',
				'Surveyor Saga',
			]);
			expect(result.entries[1]).toMatchObject({
				name: 'Reflection',
				deckCount: 1,
				sourceCardCount: 1,
			});
		});

		it('respects scoped deck count filters from the metagame scope model', async () => {
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }]));
			mockDb.select.mockReturnValueOnce(makeSelectChain([
				{
					deckId: 1,
					cardId: 10,
					cardName: 'Treasure Maker',
					cardScryfallId: 'source-10',
					cardType: 'Creature',
					deckTokens: [
						{ id: 'treasure', scryfallId: 'treasure', name: 'Treasure', typeLine: 'Token Artifact - Treasure', uri: null },
					],
				},
			]));

			const result = await metagameService().getTokenRequirements(1, 'topN', 1);

			expect(result.totalDecks).toBe(1);
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0]).toMatchObject({ name: 'Treasure', deckCount: 1 });
		});
	});

	// ── getSummary ──

	describe('getSummary', () => {
		it('returns totalPlayers, classifiedPlayers, deck totals, facts, topArchetypes, and topCards', async () => {
			// scope='all' — no upfront IDs select. Scope/counts are now resolved
			// once and threaded through, so the call sequence is:
			// 1. getSummary: totalPlayers COUNT → {c:4}
			// 2. getSummary: totalArchetypes → {c:2}
			// 3. computeArchetypeBreakdown: classifiedRows → 3 rows
			// 4. computeArchetypeBreakdown: archetypeRows → [] (no matching archetype → entries=[])
			// computeCardBreakdown: no select (totalDecks=0 via selectDistinct → [])
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 4 }]))
				.mockReturnValueOnce(makeSelectChain([{ c: 2 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 1, losses: 0, points: 3, position: 1 },
					{ archetypeId: 1, wins: 1, losses: 0, points: 3, position: 2 },
					{ archetypeId: 1, wins: 1, losses: 0, points: 3, position: 3 },
				]))
				.mockReturnValueOnce(makeSelectChain([]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));

			const result = await metagameService().getSummary(1, 'all');

			expect(result.totalPlayers).toBe(4);
			expect(result.classifiedPlayers).toBe(3);
			expect(result.totalDecks).toBe(0);
			expect(result.totalArchetypes).toBe(2);
			expect(result.scopedArchetypeCount).toBe(0);
			expect(result.scope).toBe('all');
			expect(result.facts).toEqual([]);
			expect(result.topArchetypes).toBeInstanceOf(Array);
			expect(result.topCards).toBeInstanceOf(Array);
		});

		it('filters only basic lands from summary facts and topCards', async () => {
			// Scope/counts resolved once and threaded through:
			// 1. getSummary: totalPlayers COUNT → {c:2}
			// 2. getSummary: totalArchetypes → {c:1}
			// 3. computeArchetypeBreakdown: classifiedRows → 2 rows
			// 4. computeArchetypeBreakdown: archetypeRows → [Mono Red]
			// 5. computeCardBreakdown: aggRows (totalDecks=2 via selectDistinct)
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 2 }]))
				.mockReturnValueOnce(makeSelectChain([{ c: 1 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 4, losses: 2, points: 12, position: 1, deckColors: 'R' },
					{ archetypeId: 1, wins: 3, losses: 3, points: 9, position: 2, deckColors: 'R' },
				]))
				.mockReturnValueOnce(makeSelectChain([
					{ id: 1, name: 'Mono Red', colors: 'R', eventId: 1 },
				]))
				.mockReturnValueOnce(makeGroupByChain([
					{ cardId: 1, name: 'Mountain', cardType: 'Basic Land', scryfallId: null, colors: 'R', cmc: 0, manaCost: null, totalCopies: 20, mainboardCount: 20, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
					{ cardId: 2, name: 'Lightning Bolt', cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}', totalCopies: 8, mainboardCount: 8, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
					{ cardId: 3, name: 'Restless Anchorage', cardType: 'Land Creature', scryfallId: null, colors: 'WU', cmc: 0, manaCost: null, totalCopies: 6, mainboardCount: 6, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2 },
					{ cardId: 4, name: 'Shatterskull Smashing', cardType: 'Sorcery // Land', scryfallId: null, colors: 'R', cmc: 2, manaCost: '{X}{R}{R}', totalCopies: 2, mainboardCount: 2, sideboardCount: 0, mainboardDeckCount: 1, sideboardDeckCount: 0, deckCount: 1 },
				]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([{ playerId: 1 }, { playerId: 2 }]));

			const result = await metagameService().getSummary(1, 'all');

			expect(result.topCards.map((entry: { name: string }) => entry.name)).toEqual([
				'Lightning Bolt',
				'Restless Anchorage',
				'Shatterskull Smashing',
			]);
			expect(result.topCards.some((entry: { name: string }) => entry.name === 'Mountain')).toBe(false);
			expect(result.facts).toEqual(expect.arrayContaining([
				expect.objectContaining({ key: 'mostPlayedCards' }),
			]));
		});
	});

	// ── getArchetypeDetail ──

	describe('getArchetypeDetail', () => {
		it('players include deckName field (null when not present in row)', async () => {
			const arch = { id: 1, name: 'Mono Red', colors: 'R', eventId: 1 };
			mockDb.query.archetypes.findFirst.mockResolvedValue(arch);

			const playerRow = { id: 1, name: 'Player 1', position: 1, points: 15, wins: 5, losses: 1, draws: 0, deckColors: 'R', deckName: 'My Deck' };

			mockDb.select
				.mockReturnValueOnce(makeOrderByChain([playerRow]))
				.mockReturnValueOnce(makeSelectChain([{ id: 1 }]))
				.mockReturnValueOnce(makeSelectChain([{ c: 1 }]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));

			const result = await metagameService().getArchetypeDetail(1, 1, 'all');

			expect(result!.players[0].deckName).toBe('My Deck');
		});

		it('players deckName is null when not provided', async () => {
			const arch = { id: 1, name: 'Mono Red', colors: 'R', eventId: 1 };
			mockDb.query.archetypes.findFirst.mockResolvedValue(arch);

			const playerRow = { id: 1, name: 'Player 1', position: 1, points: 15, wins: 5, losses: 1, draws: 0, deckColors: 'R' };

			mockDb.select
				.mockReturnValueOnce(makeOrderByChain([playerRow]))
				.mockReturnValueOnce(makeSelectChain([{ id: 1 }]))
				.mockReturnValueOnce(makeSelectChain([{ c: 1 }]));
			mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));

			const result = await metagameService().getArchetypeDetail(1, 1, 'all');

			expect(result!.players[0].deckName).toBeNull();
		});
	});
});
