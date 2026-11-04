import { describe, expect, it } from 'vitest';
import { compareCardBreakdownEntries, createCardTypeBucketFilter, isEligibleMetagameCard, metagameCardType, toCardBreakdownEntry } from '~~/server/modules/metagame/cards';

const row = {
	cardId: 1,
	name: 'Lightning Bolt',
	cardType: 'Instant',
	scryfallId: 'scryfall-1',
	colors: 'R',
	cmc: 1,
	manaCost: '{R}',
	cardNumber: null,
	imageUrl: null,
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

	// MTG leaves basic lands out; OP counts its categories past the Leader, which is the Archetype (ADR-0074).
	it.each([
		[
			'mtg',
			{ cardType: 'Instant' },
			true,
		],
		[
			'mtg',
			{ cardType: 'Basic Land — Mountain' },
			false,
		],
		[
			'op',
			{ cardType: null, category: 'character' },
			true,
		],
		[
			'op',
			{ cardType: null, category: 'event' },
			true,
		],
		[
			'op',
			{ cardType: null, category: 'stage' },
			true,
		],
		[
			'op',
			{ cardType: null, category: 'leader' },
			false,
		],
	] as const)('on %s, counts %j: %s', (game, card, eligible) => {
		expect(isEligibleMetagameCard(game, card)).toBe(eligible);
	});

	it.each([
		[
			'mtg',
			{ cardType: 'Legendary Creature — Human' },
			'Legendary Creature — Human',
		],
		[
			'op',
			{ cardType: null, category: 'character' },
			'Character',
		],
		[
			'op',
			{ cardType: null, category: 'event' },
			'Event',
		],
		[
			'op',
			{ cardType: null, category: 'stage' },
			'Stage',
		],
	] as const)('on %s, shows %j as the type %s', (game, card, cardType) => {
		expect(metagameCardType(game, card)).toBe(cardType);
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
		expect(createCardTypeBucketFilter('mtg', undefined)('Instant')).toBe(true);
		expect(createCardTypeBucketFilter('mtg', [])('Land — Island')).toBe(true);
	});

	it('drops cards whose front-face bucket is excluded', () => {
		const filter = createCardTypeBucketFilter('mtg', ['Land', 'Creature']);

		expect(filter('Legendary Creature — Human Wizard')).toBe(false);
		expect(filter('Land — Urza’s Saga')).toBe(false);
		expect(filter('Instant')).toBe(true);
	});

	it('buckets by the front face of a double-faced card', () => {
		const filter = createCardTypeBucketFilter('mtg', ['Land']);

		// Front face is a Sorcery, back face a Land — the front face decides.
		expect(filter('Sorcery // Land')).toBe(true);
		expect(filter('Land // Creature')).toBe(false);
	});

	it('maps unmatched types to the Other bucket', () => {
		const filter = createCardTypeBucketFilter('mtg', ['Other']);

		expect(filter('Conspiracy')).toBe(false);
		expect(filter(null)).toBe(false);
		expect(filter('Artifact')).toBe(true);
	});

	it('buckets an OP card by its Metagame type, which no MTG type names', () => {
		const filter = createCardTypeBucketFilter('op', ['Event', 'Land']);

		expect(filter('Event')).toBe(false);
		expect(filter('Character')).toBe(true);
		expect(filter('Stage')).toBe(true);
	});
});
