import { describe, expect, it } from 'vitest';

describe('useDeckCardGroups', () => {
	it('splits, sorts, totals, and groups mainboard and sideboard cards reactively', () => {
		const cards = ref([
			{ name: 'Negate', compartment: 'sideboard', cardType: 'Instant', cmc: 2, quantity: 2 },
			{ name: 'Island', compartment: 'mainboard', cardType: 'Land', cmc: 0, quantity: 4 },
			{ name: 'Delver of Secrets', compartment: 'mainboard', cardType: 'Creature', cmc: 1, quantity: 4 },
			{ name: 'Lightning Bolt', compartment: 'mainboard', cardType: 'Instant', cmc: 1, quantity: 4 },
		]);

		const groups = useDeckCardGroups(cards);

		expect(groups.mainboardCards.value.map(card => card.name)).toEqual([
			'Delver of Secrets',
			'Lightning Bolt',
			'Island',
		]);
		expect(groups.sideboardCards.value.map(card => card.name)).toEqual(['Negate']);
		expect(groups.mainboardTotal.value).toBe(12);
		expect(groups.sideboardTotal.value).toBe(2);
		expect([...groups.mainboardByType.value.keys()]).toEqual(['Creature', 'Instant', 'Land']);
		expect(groups.mainboardByCmc.value.get('1')?.map(card => card.name)).toEqual(['Delver of Secrets', 'Lightning Bolt']);

		cards.value.push({ name: 'Duress', compartment: 'sideboard', cardType: 'Sorcery', cmc: 1, quantity: 3 });

		expect(groups.sideboardTotal.value).toBe(5);
		expect(groups.sideboardByType.value.get('Instant')?.map(card => card.name)).toEqual(['Negate']);
		expect(groups.sideboardByType.value.get('Sorcery')?.map(card => card.name)).toEqual(['Duress']);
	});
});
