import { describe, expect, it } from 'vitest';
import { compareCardBreakdownEntries, isEligibleMetagameCard, toCardBreakdownEntry } from '~~/server/modules/metagame/cards';

const row = {
	cardId: 1,
	name: 'Lightning Bolt',
	cardType: 'Instant',
	scryfallId: 'scryfall-1',
	colors: 'R',
	cmc: 1,
	manaCost: '{R}',
	totalCopies: 8,
	mainboardCount: 6,
	sideboardCount: 2,
	mainboardDeckCount: 3,
	sideboardDeckCount: 1,
	deckCount: 4,
};

describe('metagame card rules', () => {
	it('maps aggregated card rows into board-scoped Card breakdown entries', () => {
		expect(toCardBreakdownEntry(row, 10, 'mainboard')).toMatchObject({
			id: 1,
			name: 'Lightning Bolt',
			totalCopies: 6,
			deckCount: 3,
			inclusionRate: 30,
			avgCopies: 2,
			mainboardCount: 6,
			sideboardCount: 2,
		});
	});

	it('centralizes Metagame card eligibility', () => {
		expect(isEligibleMetagameCard('Instant')).toBe(true);
		expect(isEligibleMetagameCard('Basic Land — Mountain')).toBe(false);
	});

	it('sorts Card breakdown entries by the selected metric', () => {
		const low = toCardBreakdownEntry({ ...row, cardId: 1, deckCount: 1, totalCopies: 1 }, 10, 'both');
		const high = toCardBreakdownEntry({ ...row, cardId: 2, deckCount: 5, totalCopies: 12 }, 10, 'both');

		expect(compareCardBreakdownEntries('inclusionRate', low, high)).toBeGreaterThan(0);
		expect(compareCardBreakdownEntries('totalCopies', low, high)).toBeGreaterThan(0);
	});
});
