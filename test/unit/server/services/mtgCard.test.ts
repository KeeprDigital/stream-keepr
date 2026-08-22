import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

// ── Mocks ──

vi.mock('hub:db', () => ({ db: mockDb }));

const { mtgCardService } = await import('~~/server/services/mtgCard');

// ── Helpers ──

function createMockCard(overrides?: Partial<{
	id: number;
	name: string;
	game: string;
	scryfallId: string | null;
	oracleId: string | null;
	cardType: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
}>) {
	return {
		id: 1,
		name: 'Lightning Bolt',
		game: 'mtg',
		scryfallId: null,
		oracleId: null,
		cardType: 'Instant',
		colors: 'R',
		cmc: 1,
		manaCost: '{R}',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

// ── Tests ──

describe('mtgCardService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	// ── batchUpsert ──

	describe('batchUpsert', () => {
		it('deduplicates by lowercase name (two same-name inputs → one query)', async () => {
			const card = createMockCard({ name: 'Lightning Bolt' });
			mockDb.batch.mockResolvedValue([[card]]);

			await mtgCardService().batchUpsert([
				{ name: 'Lightning Bolt', game: 'mtg' },
				{ name: 'LIGHTNING BOLT', game: 'mtg' },
			]);

			// db.batch called with array of length 1 (deduped)
			expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(1);
		});

		it('returned Map is keyed by lowercase name', async () => {
			const card = createMockCard({ name: 'Lightning Bolt' });
			mockDb.batch.mockResolvedValue([[card]]);

			const result = await mtgCardService().batchUpsert([{ name: 'Lightning Bolt', game: 'mtg' }]);

			expect(result.has('lightning bolt')).toBe(true);
			expect(result.get('lightning bolt')).toEqual(card);
		});

		it('calls db.batch', async () => {
			const card = createMockCard({ name: 'Shock' });
			mockDb.batch.mockResolvedValue([[card]]);

			await mtgCardService().batchUpsert([{ name: 'Shock', game: 'mtg' }]);

			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('upserts one thousand consistently-shaped cards with one statement', async () => {
			const cards = Array.from({ length: 1000 }, (_, index) =>
				createMockCard({ id: index + 1, name: `Card ${index}` }));
			mockDb.batch.mockResolvedValue([cards]);

			const result = await mtgCardService().batchUpsert(cards.map(card => ({
				name: card.name,
				game: 'mtg',
				colors: card.colors,
				deckCounterTypes: [],
				deckTokens: [],
			})));

			expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(1);
			expect(result).toHaveLength(1000);
		});
	});
});
