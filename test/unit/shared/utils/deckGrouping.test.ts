import { describe, expect, it } from 'vitest';
import { groupByType } from '~~/shared/utils/deckGrouping';

describe('deckGrouping', () => {
	it('groups cards by coarse buckets in stable deck order', () => {
		const grouped = groupByType([
			{
				name: 'Volcanic Island',
				quantity: 1,
				compartment: 'mainboard',
				cardType: 'Land — Island Mountain',
			},
			{
				name: 'Lightning Bolt',
				quantity: 1,
				compartment: 'mainboard',
				cardType: 'Instant',
			},
			{
				name: 'Oko, Thief of Crowns',
				quantity: 1,
				compartment: 'mainboard',
				cardType: 'Legendary Planeswalker — Oko',
			},
			{
				name: 'Ledger Shredder',
				quantity: 1,
				compartment: 'mainboard',
				cardType: 'Creature — Bird Advisor',
			},
		]);

		expect([
			...grouped.keys(),
		]).toEqual([
			'Creature',
			'Planeswalker',
			'Instant',
			'Land',
		]);
	});
});
