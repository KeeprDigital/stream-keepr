import { describe, expect, it } from 'vitest';
import { evaluateHighlanderDeck, formatHighlanderIssueSummary, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';

function makeCard(overrides: Partial<{
	name: string;
	oracleId: string | null;
	cardType: string | null;
	quantity: number;
	compartment: 'mainboard' | 'sideboard';
}> = {}) {
	return {
		name: 'Test Card',
		oracleId: 'oracle-1',
		cardType: 'Creature',
		quantity: 1,
		compartment: 'mainboard' as const,
		...overrides,
	};
}

describe('highlander utils', () => {
	it('computes a legal 8-point deck when no Reserved List cards are present', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({
				name: 'Mana Drain',
				oracleId: '74d3277a-38e5-4732-afed-084a56148f20',
			}),
			makeCard({
				name: 'Ancient Tomb',
				oracleId: '23467047-6dba-4498-b783-1ebc4f74b8c2',
			}),
			makeCard({
				name: 'Force of Will',
				oracleId: '956381ba-6d37-4a8a-846c-bad79222dbee',
			}),
			makeCard({
				name: 'The One Ring',
				oracleId: '3aa83ed2-f48b-4ce6-a614-2c54ddf50538',
			}),
			makeCard({ name: 'Island', oracleId: 'basic-island', cardType: 'Basic Land', quantity: 20 }),
		]);

		expect(summary.status).toBe('legal');
		expect(summary.points).toBe(4);
		expect(summary.maxPoints).toBe(8);
		expect(formatHighlanderPointsLabel(summary)).toBe('4/8 Points');
	});

	it('drops to a 7-point cap when a Reserved List card is present', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({ name: 'Ancestral Recall', oracleId: '550c74d4-1fcb-406a-b02a-639a760a4380' }),
			makeCard({ name: 'Mana Drain', oracleId: '74d3277a-38e5-4732-afed-084a56148f20' }),
			makeCard({ name: 'The One Ring', oracleId: '3aa83ed2-f48b-4ce6-a614-2c54ddf50538' }),
		]);

		expect(summary.maxPoints).toBe(7);
		expect(summary.hasReserveListCards).toBe(true);
		expect(summary.points).toBe(7);
		expect(formatHighlanderPointsLabel(summary)).toBe('7 Points');
	});

	it('marks decks unknown when oracle metadata is missing', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({ name: 'Mana Drain', oracleId: '74d3277a-38e5-4732-afed-084a56148f20' }),
			makeCard({ name: 'Mystery Card', oracleId: null }),
		]);

		expect(summary.status).toBe('unknown');
		expect(summary.points).toBe(1);
		expect(summary.maxPoints).toBeNull();
		expect(summary.unknownCards).toEqual([
			{ name: 'Mystery Card', missing: ['oracleId'] },
		]);
		expect(formatHighlanderIssueSummary(summary)).toBe('1 unresolved');
	});

	it('marks duplicate non-basic cards illegal and exempts basic lands', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({ name: 'Mana Drain', oracleId: '74d3277a-38e5-4732-afed-084a56148f20', quantity: 2 }),
			makeCard({ name: 'Island', oracleId: 'basic-island', cardType: 'Basic Land', quantity: 12 }),
		]);

		expect(summary.status).toBe('illegal');
		expect(summary.duplicateCards).toEqual([{ name: 'Mana Drain', quantity: 2 }]);
		expect(formatHighlanderIssueSummary(summary)).toBe('1 duplicate');
	});

	it('exempts known basic land names even when stale card type data is missing the Basic supertype', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({ name: 'Snow-Covered Island', oracleId: 'snow-island', cardType: 'Land', quantity: 12 }),
			makeCard({ name: 'Wastes', oracleId: 'wastes', cardType: null, quantity: 5 }),
		]);

		expect(summary.status).toBe('legal');
		expect(summary.duplicateCards).toEqual([]);
	});

	it('tracks sideboard-only pointed cards in the detail list', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({
				name: 'Mana Drain',
				oracleId: '74d3277a-38e5-4732-afed-084a56148f20',
				compartment: 'sideboard',
			}),
		]);

		expect(summary.pointedCards).toEqual([
			{ name: 'Mana Drain', points: 1, compartments: ['sideboard'], totalQuantity: 1 },
		]);
	});

	it('ignores companion-only pointed cards until companion intent is modeled', () => {
		const summary = evaluateHighlanderDeck('7ph', [
			makeCard({ name: 'Lurrus of the Dream-Den', oracleId: '3bc757c1-3adb-4321-8832-8e1cc9e687f7' }),
		]);

		expect(summary.points).toBe(0);
		expect(summary.pointedCards).toEqual([]);
	});

	it('counts companion-only pointed cards when an explicit companion is set', () => {
		const summary = evaluateHighlanderDeck(
			'7ph',
			[makeCard({ name: 'Lightning Bolt', oracleId: 'oracle-bolt' })],
			{ name: 'Lutri, the Spellchaser', oracleId: '158a6225-a246-4fd6-aa57-0df8067b4383' },
		);

		expect(summary.points).toBe(3);
		expect(summary.pointedCards).toEqual([
			{
				name: 'Lutri, the Spellchaser',
				points: 3,
				compartments: [],
				totalQuantity: 1,
				pointedAs: 'companion',
			},
		]);
	});
});
