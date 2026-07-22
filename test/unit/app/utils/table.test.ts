import { describe, expect, it } from 'vitest';
import { sortByManaCost } from '~~/shared/utils/manaCostSort';

interface CardCostFields { cmc?: number | null; colors?: string | null }

/** Helper — sorts an array of cost records and returns names for readability. */
function sortCards(cards: (CardCostFields & { name: string })[]) {
	return [...cards].sort((a, b) => sortByManaCost(a, b)).map(c => c.name);
}

describe('sortByManaCost', () => {
	describe('cMC ordering', () => {
		it('sorts lower CMC before higher CMC', () => {
			const cards = [
				{ name: 'Three', cmc: 3, colors: 'W' },
				{ name: 'One', cmc: 1, colors: 'W' },
				{ name: 'Two', cmc: 2, colors: 'W' },
			];
			expect(sortCards(cards)).toEqual(['One', 'Two', 'Three']);
		});

		it('places null CMC last', () => {
			const cards = [
				{ name: 'Unknown', cmc: null, colors: 'W' },
				{ name: 'One', cmc: 1, colors: 'W' },
			];
			expect(sortCards(cards)).toEqual(['One', 'Unknown']);
		});

		it('places undefined CMC last (same as null)', () => {
			const cards = [
				{ name: 'NoCmc', colors: 'U' },
				{ name: 'Two', cmc: 2, colors: 'U' },
			];
			expect(sortCards(cards)).toEqual(['Two', 'NoCmc']);
		});

		it('handles CMC 0 (lands, zero-cost cards)', () => {
			const cards = [
				{ name: 'One', cmc: 1, colors: 'W' },
				{ name: 'Zero', cmc: 0, colors: null },
			];
			expect(sortCards(cards)).toEqual(['Zero', 'One']);
		});
	});

	describe('single-colour WUBRGC order within same CMC', () => {
		it('orders W → U → B → R → G → C within CMC 2', () => {
			const cards = [
				{ name: 'G', cmc: 2, colors: 'G' },
				{ name: 'R', cmc: 2, colors: 'R' },
				{ name: 'W', cmc: 2, colors: 'W' },
				{ name: 'B', cmc: 2, colors: 'B' },
				{ name: 'U', cmc: 2, colors: 'U' },
				{ name: 'C', cmc: 2, colors: 'C' },
			];
			expect(sortCards(cards)).toEqual(['W', 'U', 'B', 'R', 'G', 'C']);
		});

		it('treats null colors as colourless (C position)', () => {
			const cards = [
				{ name: 'Artifact', cmc: 2, colors: null },
				{ name: 'Green', cmc: 2, colors: 'G' },
				{ name: 'White', cmc: 2, colors: 'W' },
			];
			// Artifact (null = colourless) should rank after G, same as 'C'
			expect(sortCards(cards)).toEqual(['White', 'Green', 'Artifact']);
		});

		it('treats empty string colors as colourless (C position)', () => {
			const cards = [
				{ name: 'Artifact', cmc: 1, colors: '' },
				{ name: 'Blue', cmc: 1, colors: 'U' },
			];
			expect(sortCards(cards)).toEqual(['Blue', 'Artifact']);
		});
	});

	describe('multicolour cards sort after single-colour', () => {
		it('places a multicolour card after single-colour cards at the same CMC', () => {
			const cards = [
				{ name: 'Multi', cmc: 2, colors: 'WU' },
				{ name: 'White', cmc: 2, colors: 'W' },
				{ name: 'Blue', cmc: 2, colors: 'U' },
			];
			expect(sortCards(cards)).toEqual(['White', 'Blue', 'Multi']);
		});

		it('places multicolour cards after all single-colour cards regardless of color combination', () => {
			const cards = [
				{ name: 'WUBRG', cmc: 5, colors: 'WUBRG' },
				{ name: 'WU', cmc: 5, colors: 'WU' },
				{ name: 'Green', cmc: 5, colors: 'G' },
			];
			expect(sortCards(cards)).toEqual(['Green', 'WUBRG', 'WU']);
		});

		it('two multicolour cards at the same CMC are considered equal (stable)', () => {
			const result = sortByManaCost(
				{ cmc: 3, colors: 'WU' },
				{ cmc: 3, colors: 'BR' },
			);
			expect(result).toBe(0);
		});
	});

	describe('combined CMC + colour ordering', () => {
		it('cMC takes priority over colour', () => {
			const cards = [
				{ name: 'BlueOne', cmc: 1, colors: 'U' },
				{ name: 'WhiteTwo', cmc: 2, colors: 'W' },
			];
			// BlueOne (CMC 1) beats WhiteTwo (CMC 2) even though W < U in colour order
			expect(sortCards(cards)).toEqual(['BlueOne', 'WhiteTwo']);
		});

		it('multicolour at lower CMC still beats single-colour at higher CMC', () => {
			const cards = [
				{ name: 'SingleThree', cmc: 3, colors: 'W' },
				{ name: 'MultiTwo', cmc: 2, colors: 'WU' },
			];
			expect(sortCards(cards)).toEqual(['MultiTwo', 'SingleThree']);
		});

		it('full mixed sort: CMC first, then colour/multi within same CMC', () => {
			const cards = [
				{ name: 'MultiTwo', cmc: 2, colors: 'WU' },
				{ name: 'GreenOne', cmc: 1, colors: 'G' },
				{ name: 'WhiteTwo', cmc: 2, colors: 'W' },
				{ name: 'Artifact', cmc: 2, colors: null },
				{ name: 'BlueOne', cmc: 1, colors: 'U' },
				{ name: 'Unknown', cmc: null, colors: 'W' },
			];
			expect(sortCards(cards)).toEqual([
				'BlueOne', // CMC 1, U (idx 1)
				'GreenOne', // CMC 1, G (idx 4)
				'WhiteTwo', // CMC 2, W (idx 0)
				'Artifact', // CMC 2, colourless/null (C, idx 5)
				'MultiTwo', // CMC 2, multicolour (after all single-colour)
				'Unknown', // CMC null — last
			]);
		});
	});
});
