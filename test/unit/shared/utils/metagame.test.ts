import { describe, expect, it } from 'vitest';
import { CARD_TYPE_BUCKET_ORDER, getCardTypeBucket, getCardTypeBucketOrder, getCardTypeDisplayLabel, getMetagameCardTypeBuckets, isMetagameColumnOffered, isMetagameSortOffered, metagameCardImageUrl } from '~~/shared/utils/metagame';

describe('metagame card type display helpers', () => {
	it('maps canonical type lines to coarse display buckets', () => {
		expect(getCardTypeBucket('Legendary Creature — Dog')).toBe('Creature');
		expect(getCardTypeBucket('Land — Forest Island')).toBe('Land');
		expect(getCardTypeBucket('Legendary Planeswalker — Ashiok')).toBe('Planeswalker');
		expect(getCardTypeBucket('Enchantment Land — Urza\'s Saga')).toBe('Enchantment');
		expect(getCardTypeBucket('Legendary Land')).toBe('Land');
		expect(getCardTypeBucket('Creature // Land')).toBe('Creature');
	});

	it('supports metagame-specific land labeling without changing the bucket', () => {
		expect(getCardTypeDisplayLabel('Land — Island Mountain', { nonbasicLandLabel: true })).toBe('Nonbasic Land');
		expect(getCardTypeDisplayLabel('Land — Island Mountain')).toBe('Land');
	});

	it('uses the shared bucket ordering consistently', () => {
		expect(CARD_TYPE_BUCKET_ORDER).toEqual([
			'Creature',
			'Planeswalker',
			'Battle',
			'Instant',
			'Sorcery',
			'Artifact',
			'Enchantment',
			'Land',
			'Other',
		]);
		expect(getCardTypeBucketOrder('Creature — Human')).toBeLessThan(getCardTypeBucketOrder('Instant'));
		expect(getCardTypeBucketOrder('Instant')).toBeLessThan(getCardTypeBucketOrder('Land'));
	});
});

describe('what each Card Game\'s Metagame offers', () => {
	// An OP Metagame reads participation only, and its cards no mana cost or Sideboard (ADR-0074).
	it.each([
		['winRate', false],
		['avgPlace', false],
		['conversionRate', false],
		['manaCost', false],
		['sideboardCount', false],
		['archetype', true],
		['count', true],
		['metaShare', true],
		['colors', true],
		['card', true],
		['type', true],
		['inclusionRate', true],
		['avgCopies', true],
		['totalCopies', true],
		['deckCount', true],
		['mainboardCount', true],
	] as const)('offers a One Piece Event the %s column: %s', (column, offered) => {
		expect(isMetagameColumnOffered('op', column)).toBe(offered);
		expect(isMetagameColumnOffered('mtg', column)).toBe(true);
	});

	it.each([
		['metaShare', true],
		['count', true],
		['winRate', false],
		['conversionRate', false],
	] as const)('offers a One Piece Event the %s archetype order: %s', (sortBy, offered) => {
		expect(isMetagameSortOffered('op', sortBy)).toBe(offered);
		expect(isMetagameSortOffered('mtg', sortBy)).toBe(true);
	});

	it.each([
		['mtg', CARD_TYPE_BUCKET_ORDER],
		[
			'op',
			['Character', 'Event', 'Stage'],
		],
	] as const)('groups a %s Metagame\'s cards by %j', (game, buckets) => {
		expect(getMetagameCardTypeBuckets(game)).toEqual(buckets);
	});

	it.each([
		[
			{ imageUrl: 'https://cards-img.keepr.digital/OP01-025.png', scryfallId: null },
			'https://cards-img.keepr.digital/OP01-025.png',
		],
		[
			{ imageUrl: null, scryfallId: 'abcdef' },
			'https://cards.scryfall.io/normal/front/a/b/abcdef.jpg',
		],
		[
			{ scryfallId: null },
			null,
		],
	])('images the card %j by %s', (card, url) => {
		expect(metagameCardImageUrl(card)).toBe(url);
	});
});
