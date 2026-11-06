import { describe, expect, it } from 'vitest';
import { opCardMatchesText } from '~~/shared/utils/card/op';

const LUFFY = {
	number: 'EB02-010',
	name: 'Monkey.D.Luffy',
	colors: ['Green', 'Purple'],
};

describe('opCardMatchesText', () => {
	it.each([
		['part of a name word', 'luf', true],
		['a word inside a dotted name', 'd', true],
		['words in any order, any case', 'LUFFY monkey', true],
		['a colour with a name word', 'purple luf', true],
		['part of the card number', 'b02-01', true],
		['the set code', 'eb02', true],
		['a word that starts no word', 'uffy', false],
		['one word that matches nothing', 'luf zoro', false],
		['a different card number', 'OP01-001', false],
		['blank text', '   ', false],
	])('%s: %j → %s', (_case, text, matches) => {
		expect(opCardMatchesText(LUFFY, text)).toBe(matches);
	});
});
