import { describe, expect, it } from 'vitest';
import { sortByManaCost } from '~~/shared/utils/manaCostSort';

function sortCards(cards: { name: string; cmc?: number | null; colors?: string | null }[]) {
	return [...cards].sort(sortByManaCost).map(card => card.name);
}

describe('sortByManaCost', () => {
	it('orders by CMC, then W U B R G colourless, then multicolour, with unknown CMC last', () => {
		expect(sortCards([
			{ name: 'Unknown', cmc: null, colors: 'W' },
			{ name: 'NoCmc', colors: 'U' },
			{ name: 'MultiTwo', cmc: 2, colors: 'WU' },
			{ name: 'Artifact', cmc: 2, colors: null },
			{ name: 'Eldrazi', cmc: 2, colors: '' },
			{ name: 'GreenTwo', cmc: 2, colors: 'G' },
			{ name: 'RedTwo', cmc: 2, colors: 'R' },
			{ name: 'BlackTwo', cmc: 2, colors: 'B' },
			{ name: 'BlueTwo', cmc: 2, colors: 'U' },
			{ name: 'WhiteTwo', cmc: 2, colors: 'W' },
			{ name: 'MultiOne', cmc: 1, colors: 'BR' },
			{ name: 'Land', cmc: 0, colors: null },
		])).toEqual([
			'Land',
			'MultiOne',
			'WhiteTwo',
			'BlueTwo',
			'BlackTwo',
			'RedTwo',
			'GreenTwo',
			'Artifact',
			'Eldrazi',
			'MultiTwo',
			'Unknown',
			'NoCmc',
		]);
	});

	it('treats two multicolour cards at the same CMC as equal, so the sort stays stable', () => {
		expect(sortByManaCost({ cmc: 3, colors: 'WU' }, { cmc: 3, colors: 'BR' })).toBe(0);
	});
});
