import { describe, expect, it } from 'vitest';
import { computeBoardScopedCardMetrics, computeMetagameWinRate } from '~~/server/services/metagameMetrics';

describe('metagame metrics service helpers', () => {
	it('computes rounded win rates and returns null with no matches', () => {
		expect(computeMetagameWinRate(7, 3)).toBe(70);
		expect(computeMetagameWinRate(1, 2)).toBe(33.33);
		expect(computeMetagameWinRate(0, 0)).toBeNull();
	});

	it('computes card metrics for the full deck, mainboard, and sideboard', () => {
		const row = {
			totalCopies: 18,
			mainboardCount: 12,
			sideboardCount: 6,
			mainboardDeckCount: 4,
			sideboardDeckCount: 3,
			deckCount: 5,
		};

		expect(computeBoardScopedCardMetrics(row, 20, 'full')).toEqual({
			deckCount: 5,
			totalCopies: 18,
			inclusionRate: 25,
			avgCopies: 3.6,
		});
		expect(computeBoardScopedCardMetrics(row, 20, 'mainboard')).toEqual({
			deckCount: 4,
			totalCopies: 12,
			inclusionRate: 20,
			avgCopies: 3,
		});
		expect(computeBoardScopedCardMetrics(row, 20, 'sideboard')).toEqual({
			deckCount: 3,
			totalCopies: 6,
			inclusionRate: 15,
			avgCopies: 2,
		});
	});

	it('returns zero rates when no decks contain the card or no decks are in scope', () => {
		const row = {
			totalCopies: 0,
			mainboardCount: 0,
			sideboardCount: 0,
			mainboardDeckCount: 0,
			sideboardDeckCount: 0,
			deckCount: 0,
		};

		expect(computeBoardScopedCardMetrics(row, 0, 'full')).toEqual({
			deckCount: 0,
			totalCopies: 0,
			inclusionRate: 0,
			avgCopies: 0,
		});
	});
});
