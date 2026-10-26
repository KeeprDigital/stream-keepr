import { describe, expect, it } from 'vitest';
import { compareCardBreakdownEntries, createCardTypeBucketFilter, isEligibleMetagameCard, toCardBreakdownEntry } from '~~/server/modules/metagame/cards';

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
		const low = toCardBreakdownEntry({
			...row,
			cardId: 1,
			deckCount: 1,
			totalCopies: 1,
		}, 10, 'full');
		const high = toCardBreakdownEntry({
			...row,
			cardId: 2,
			deckCount: 5,
			totalCopies: 12,
		}, 10, 'full');

		expect(compareCardBreakdownEntries('inclusionRate', low, high)).toBeGreaterThan(0);
		expect(compareCardBreakdownEntries('totalCopies', low, high)).toBeGreaterThan(0);
	});

	it('orders tied cards by name, so a re-read cannot reshuffle them', () => {
		const tied = { ...row, deckCount: 3, totalCopies: 6 };
		const bolt = toCardBreakdownEntry({ ...tied, cardId: 1, name: 'Lightning Bolt' }, 10, 'full');
		const duress = toCardBreakdownEntry({ ...tied, cardId: 2, name: 'Duress' }, 10, 'full');

		for (const sortBy of ['inclusionRate', 'avgCopies', 'totalCopies'] as const)
			expect(compareCardBreakdownEntries(sortBy, bolt, duress)).toBeGreaterThan(0);
	});
});

describe('createCardTypeBucketFilter', () => {
	it('excludes nothing when no buckets are given', () => {
		expect(createCardTypeBucketFilter(undefined)('Instant')).toBe(true);
		expect(createCardTypeBucketFilter([])('Land — Island')).toBe(true);
	});

	it('drops cards whose front-face bucket is excluded', () => {
		const filter = createCardTypeBucketFilter(['Land', 'Creature']);

		expect(filter('Legendary Creature — Human Wizard')).toBe(false);
		expect(filter('Land — Urza’s Saga')).toBe(false);
		expect(filter('Instant')).toBe(true);
	});

	it('buckets by the front face of a double-faced card', () => {
		const filter = createCardTypeBucketFilter(['Land']);

		// Front face is a Sorcery, back face a Land — the front face decides.
		expect(filter('Sorcery // Land')).toBe(true);
		expect(filter('Land // Creature')).toBe(false);
	});

	it('maps unmatched types to the Other bucket', () => {
		const filter = createCardTypeBucketFilter(['Other']);

		expect(filter('Conspiracy')).toBe(false);
		expect(filter(null)).toBe(false);
		expect(filter('Artifact')).toBe(true);
	});
});
