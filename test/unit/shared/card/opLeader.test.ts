import type { OpCardSummary } from '~~/shared/types/card/op';
import { describe, expect, it } from 'vitest';
import { formatOpColors, opLeaderOf, parseOpColors } from '~~/shared/utils/card/op';

function leaderCard(overrides: Partial<OpCardSummary> = {}): OpCardSummary {
	return {
		number: 'OP01-001',
		name: 'Roronoa Zoro',
		category: 'leader',
		colors: ['Red'],
		cost: null,
		life: 5,
		power: 5000,
		counter: null,
		types: ['Supernovas'],
		effect: null,
		trigger: null,
		printingId: 'OP01-001',
		imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
		...overrides,
	};
}

describe('opLeaderOf', () => {
	it('snapshots a searched Leader at the Printing its values come from', () => {
		expect(opLeaderOf(leaderCard({
			colors: ['Red', 'Green'],
		}))).toEqual({
			number: 'OP01-001',
			name: 'Roronoa Zoro',
			colors: ['Red', 'Green'],
			imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
		});
	});

	it('keeps only One Piece colours, which bandai-keepr spells case-sensitively', () => {
		expect(opLeaderOf(leaderCard({
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
