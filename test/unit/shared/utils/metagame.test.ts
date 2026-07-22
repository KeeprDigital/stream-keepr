import { describe, expect, it } from 'vitest';
import { CARD_TYPE_BUCKET_ORDER, getCardTypeBucket, getCardTypeBucketOrder, getCardTypeDisplayLabel } from '~~/shared/utils/metagame';

describe('metagame card type display helpers', () => {
	it('maps canonical type lines to coarse display buckets', () => {
		expect(getCardTypeBucket('Legendary Creature — Dog')).toBe('Creature');
		expect(getCardTypeBucket('Land — Forest Island')).toBe('Land');
		expect(getCardTypeBucket('Legendary Planeswalker — Ashiok')).toBe('Planeswalker');
		expect(getCardTypeBucket('Enchantment Land — Urza\'s Saga')).toBe('Enchantment');
	});

	it('supports metagame-specific land labeling without changing the bucket', () => {
		expect(getCardTypeDisplayLabel('Land — Island Mountain', { nonbasicLandLabel: true })).toBe('Nonbasic Land');
		expect(getCardTypeDisplayLabel('Land — Island Mountain')).toBe('Land');
	});

	it('uses the shared bucket ordering consistently', () => {
		expect(CARD_TYPE_BUCKET_ORDER).toEqual(['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other']);
		expect(getCardTypeBucketOrder('Creature — Human')).toBeLessThan(getCardTypeBucketOrder('Instant'));
		expect(getCardTypeBucketOrder('Instant')).toBeLessThan(getCardTypeBucketOrder('Land'));
	});
});
