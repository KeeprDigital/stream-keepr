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

// ── Tests ──

describe('metagameService', () => {
	beforeEach(() => {
		resetDbMocks();
		mockGetMemberPlayerIds.mockReset();
		mockGetKeyCardsByArchetypeIds.mockReset().mockResolvedValue(new Map());
		mockGetKeyCards.mockReset().mockResolvedValue([]);
		// Wire up selectDistinct (added to mockDb in db-mock.ts)
		mockDb.selectDistinct.mockReturnValue(makeSelectChain([]));
	});

	// ── getArchetypeBreakdown ──

	describe('getArchetypeBreakdown', () => {
		it('returns empty entries with totalPlayers=0 when no players (scope=all)', async () => {
			// scope='all': first select is the COUNT query
			mockDb.select.mockReturnValueOnce(makeSelectChain([{ c: 0 }]));

			const result = await metagameService().getArchetypeBreakdown(1, 'all');
			expect(result.totalPlayers).toBe(0);
			expect(result.entries).toHaveLength(0);
			expect(result.classifiedPlayers).toBe(0);
			expect(result.scope).toBe('all');
		});

		it('returns empty when classifiedPlayers=0', async () => {
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 2 }])) // totalPlayers COUNT
				.mockReturnValueOnce(makeSelectChain([])); // classifiedRows → empty

			const result = await metagameService().getArchetypeBreakdown(1, 'all');
			expect(result.classifiedPlayers).toBe(0);
			expect(result.entries).toHaveLength(0);
		});

		it('returns correct scope for topN', async () => {
			// scope='topN': first select is the IDs query (no COUNT)
			mockDb.select.mockReturnValue(makeSelectChain([]));

			const result = await metagameService().getArchetypeBreakdown(1, 'topN', 'metaShare', 8);
			expect(result.scope).toBe('topN');
		});

		it('with 3 classified players (2 Mono Red, 1 Azorius): entries.length=2, monoRed.count=2', async () => {
			// scope='all':
			// 1. totalPlayers COUNT → {c:3}
			// 2. classifiedRows
			// 3. archetypeRows
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 3 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 5, losses: 1, points: 15, position: 1, deckColors: 'R' },
					{ archetypeId: 1, wins: 3, losses: 3, points: 9, position: 3, deckColors: 'R' },
					{ archetypeId: 2, wins: 4, losses: 2, points: 12, position: 2, deckColors: 'WU' },
				]))
				.mockReturnValueOnce(makeSelectChain([
					{ id: 1, name: 'Mono Red', colors: 'R', eventId: 1 },
					{ id: 2, name: 'Azorius Control', colors: 'WU', eventId: 1 },
				]));

			mockGetKeyCardsByArchetypeIds.mockResolvedValue(new Map([
				[1, [{ id: 10, name: 'Goblin Guide', game: 'mtg', scryfallId: null, cardType: null, colors: 'R', cmc: 1 }]],
			]));

			const result = await metagameService().getArchetypeBreakdown(1, 'all');

			expect(result.entries).toHaveLength(2);
			expect(result.totalPlayers).toBe(3);
			expect(result.classifiedPlayers).toBe(3);

			const monoRed = result.entries.find((e: { name: string }) => e.name === 'Mono Red')!;
			expect(monoRed.count).toBe(2);
			expect(monoRed.metaShare).toBeCloseTo(66.67, 1);
			expect(monoRed.winRate).toBeCloseTo(66.67, 1);
			expect(monoRed.keyCards).toHaveLength(1);
		});

		it('sortBy=\'count\' → entries ordered by count descending', async () => {
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 3 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 5, losses: 1, points: 15, position: 1, deckColors: 'R' },
					{ archetypeId: 1, wins: 3, losses: 3, points: 9, position: 3, deckColors: 'R' },
					{ archetypeId: 2, wins: 4, losses: 2, points: 12, position: 2, deckColors: 'WU' },
				]))
				.mockReturnValueOnce(makeSelectChain([
					{ id: 1, name: 'Mono Red', colors: 'R', eventId: 1 },
					{ id: 2, name: 'Azorius Control', colors: 'WU', eventId: 1 },
				]));

			const result = await metagameService().getArchetypeBreakdown(1, 'all', 'count');

			expect(result.entries[0].name).toBe('Mono Red');
			expect(result.entries[1].name).toBe('Azorius Control');
		});

		it('sortBy=\'winRate\' → entries ordered by winRate descending (nulls last)', async () => {
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 2 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 1, losses: 9, points: 3, position: 2, deckColors: 'R' },
					{ archetypeId: 2, wins: 9, losses: 1, points: 27, position: 1, deckColors: 'WU' },
				]))
				.mockReturnValueOnce(makeSelectChain([
					{ id: 1, name: 'Mono Red', colors: 'R', eventId: 1 },
					{ id: 2, name: 'Azorius Control', colors: 'WU', eventId: 1 },
				]));

			const result = await metagameService().getArchetypeBreakdown(1, 'all', 'winRate');

			// Azorius: 9/10 = 90%, Mono Red: 1/10 = 10%
			expect(result.entries[0].name).toBe('Azorius Control');
			expect(result.entries[1].name).toBe('Mono Red');
		});

		it('uses archetype name as a stable tie-breaker when meta share ties', async () => {
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 2 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 1, losses: 1, points: 3, position: 2, deckColors: 'R' },
					{ archetypeId: 2, wins: 1, losses: 1, points: 3, position: 1, deckColors: 'W' },
				]))
				.mockReturnValueOnce(makeSelectChain([
					{ id: 1, name: 'Zoo', colors: 'R', eventId: 1 },
					{ id: 2, name: 'Affinity', colors: 'W', eventId: 1 },
				]));

			const result = await metagameService().getArchetypeBreakdown(1, 'all');

			expect(result.entries.map((entry: { name: string }) => entry.name)).toEqual(['Affinity', 'Zoo']);
		});

		it('uses archetype name as a stable tie-breaker when win rate ties', async () => {
			mockDb.select
				.mockReturnValueOnce(makeSelectChain([{ c: 2 }]))
				.mockReturnValueOnce(makeSelectChain([
					{ archetypeId: 1, wins: 2, losses: 1, points: 6, position: 2, deckColors: 'R' },
					{ archetypeId: 2, wins: 2, losses: 1, points: 9, position: 1, deckColors: 'W' },
				]))
				.mockReturnValueOnce(makeSelectChain([
					{ id: 1, name: 'Zoo', colors: 'R', eventId: 1 },
					{ id: 2, name: 'Affinity', colors: 'W', eventId: 1 },
				]));

			const result = await metagameService().getArchetypeBreakdown(1, 'all', 'winRate');

			expect(result.entries.map((entry: { name: string }) => entry.name)).toEqual(['Affinity', 'Zoo']);
		});
	});

	// ── getCardBreakdown ──
});
