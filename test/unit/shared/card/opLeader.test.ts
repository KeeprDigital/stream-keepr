import { describe, expect, it } from 'vitest';
import { formatOpColors, isOpCardImageUrl, opLeaderOf, parseOpColors } from '~~/shared/utils/card/op';
import { opCardSummary, ZORO } from '~~/test/helpers/opCards';

describe('opLeaderOf', () => {
	it('snapshots a searched Leader at the Printing its values come from', () => {
		expect(opLeaderOf(opCardSummary())).toEqual(ZORO);
	});

	it('keeps only One Piece colours, which bandai-keepr spells case-sensitively', () => {
		expect(opLeaderOf(opCardSummary({
			colors: ['red', 'Purple', 'Teal'],
		})).colors).toEqual(['Purple']);
	});
});

describe('one Piece colours as text', () => {
	it.each([
		{
			colors: ['Red'] as const,
			text: 'Red',
		},
		{
			colors: ['Red', 'Green'] as const,
			text: 'Red/Green',
		},
		{ colors: [] as const, text: '' },
	])('writes $colors as "$text" and reads it back', ({ colors, text }) => {
		expect(formatOpColors(colors)).toBe(text);
		expect(parseOpColors(text)).toEqual(colors);
	});

	it.each([
		{ text: 'WU', colors: [] },
		{
			text: 'red/Green',
			colors: ['Green'],
		},
		{
			text: ' Blue / Black ',
			colors: ['Blue', 'Black'],
		},
	])('reads "$text" as only the One Piece colours it names', ({ text, colors }) => {
		expect(parseOpColors(text)).toEqual(colors);
	});
});

// A broadcast loads only a bandai-keepr Printing image.
describe('isOpCardImageUrl', () => {
	it.each([
		{ url: 'https://cards-img.keepr.digital/OP01-001_p1.png', image: true },
		{ url: 'https://example.com/OP01-001.png', image: false },
		{ url: 'https://cards-img.keepr.digital.example.com/OP01-001.png', image: false },
		{ url: 'http://cards-img.keepr.digital/OP01-001.png', image: false },
		{ url: 'OP01-001.png', image: false },
	])('takes $url as a card image: $image', ({ url, image }) => {
		expect(isOpCardImageUrl(url)).toBe(image);
	});
});
