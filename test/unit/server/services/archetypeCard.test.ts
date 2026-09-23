import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

// ── Mocks ──

vi.mock('~~/server/db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	archetypeCards: {
		id: 'archetype_cards.id',
		archetypeId: 'archetype_cards.archetype_id',
		cardId: 'archetype_cards.card_id',
		sortOrder: 'archetype_cards.sort_order',
	},
	cards: {
		id: 'cards.id',
		name: 'cards.name',
		game: 'cards.game',
		scryfallId: 'cards.scryfallId',
		cardType: 'cards.cardType',
		colors: 'cards.colors',
		cmc: 'cards.cmc',
		createdAt: 'cards.createdAt',
		updatedAt: 'cards.updatedAt',
	},
}));

const { archetypeCardService } = await import('~~/server/services/archetypeCard');

// ── Helpers ──

function createMockKeyCard(overrides?: Partial<{
	id: number;
	name: string;
	game: string;
	scryfallId: string | null;
	cardType: string | null;
	colors: string | null;
	cmc: number | null;
	sortOrder: number;
	archetypeId?: number;
}>) {
	return {
		id: 1,
		name: 'Lightning Bolt',
		game: 'mtg',
		scryfallId: null,
		cardType: 'Instant',
		colors: 'R',
		cmc: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		sortOrder: 0,
		...overrides,
	};
}

// ── Tests ──

describe('archetypeCardService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	// ── getKeyCards ──

	describe('getKeyCards', () => {
		it('returns rows ordered by sortOrder', async () => {
			const rows = [
				createMockKeyCard({ id: 1, name: 'Lightning Bolt', sortOrder: 0 }),
				createMockKeyCard({ id: 2, name: 'Goblin Guide', sortOrder: 1 }),
			];
			getChain('select').orderBy.mockResolvedValue(rows);

			const result = await archetypeCardService().getKeyCards(1);

			expect(result).toEqual(rows);
			expect(result[0]!.sortOrder).toBe(0);
			expect(result[1]!.sortOrder).toBe(1);
		});

		it('returns empty array when no rows', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await archetypeCardService().getKeyCards(1);

			expect(result).toEqual([]);
		});
	});

	// ── setKeyCards ──

	describe('setKeyCards', () => {
		it('non-empty replaces existing (calls db.batch)', async () => {
			const mockKeyCards = [createMockKeyCard({ id: 1, name: 'Lightning Bolt' })];
			getChain('select').orderBy.mockResolvedValue(mockKeyCards);
			mockDb.batch.mockResolvedValue([]);

			const result = await archetypeCardService().setKeyCards(1, [1, 2]);

			expect(mockDb.batch).toHaveBeenCalledOnce();
			expect(result).toEqual(mockKeyCards);
		});
	});

	// ── getKeyCardsByArchetypeIds ──

	describe('getKeyCardsByArchetypeIds', () => {
		it('non-empty builds correct Map keyed by archetypeId', async () => {
			const rows = [
				{ ...createMockKeyCard({ id: 1, name: 'Lightning Bolt', sortOrder: 0 }), archetypeId: 10 },
				{ ...createMockKeyCard({ id: 2, name: 'Goblin Guide', sortOrder: 1 }), archetypeId: 10 },
				{ ...createMockKeyCard({ id: 3, name: 'Counterspell', sortOrder: 0, colors: 'UU' }), archetypeId: 20 },
			];
			getChain('select').orderBy.mockResolvedValue(rows);

			const result = await archetypeCardService().getKeyCardsByArchetypeIds([10, 20]);

			expect(result.get(10)).toHaveLength(2);
			expect(result.get(20)).toHaveLength(1);
			expect(result!.get(10)![0]!.name).toBe('Lightning Bolt');
			expect(result!.get(20)![0]!.name).toBe('Counterspell');
		});
	});
});
