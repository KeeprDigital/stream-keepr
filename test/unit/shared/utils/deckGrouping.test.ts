import { describe, expect, it } from 'vitest';
import { groupByType } from '~~/shared/utils/deckGrouping';
import { getCardTypeBucket } from '~~/shared/utils/metagame';

describe('deckGrouping', () => {
	it('normalizes full canonical type lines into coarse deck buckets', () => {
		expect(getCardTypeBucket('Legendary Creature — Dog')).toBe('Creature');
		expect(getCardTypeBucket('Legendary Land')).toBe('Land');
		expect(getCardTypeBucket('Land — Forest Island')).toBe('Land');
		expect(getCardTypeBucket('Legendary Planeswalker — Oko')).toBe('Planeswalker');
		expect(getCardTypeBucket('Creature // Land')).toBe('Creature');
	});

	it('groups cards by coarse buckets in stable deck order', () => {
		const grouped = groupByType([
			{ name: 'Volcanic Island', quantity: 1, compartment: 'mainboard', cardType: 'Land — Island Mountain' },
			{ name: 'Lightning Bolt', quantity: 1, compartment: 'mainboard', cardType: 'Instant' },
			{ name: 'Oko, Thief of Crowns', quantity: 1, compartment: 'mainboard', cardType: 'Legendary Planeswalker — Oko' },
			{ name: 'Ledger Shredder', quantity: 1, compartment: 'mainboard', cardType: 'Creature — Bird Advisor' },
		]);

		expect([...grouped.keys()]).toEqual(['Creature', 'Planeswalker', 'Instant', 'Land']);
	});
});
