import { describe, expect, it } from 'vitest';
import { fitColumns, fixedColumns, layoutScore } from '~~/shared/utils/cardGrid';

describe('cardGrid', () => {
	// The columns at which the cards are largest while every row fits the height.
	it.each([
		{
			count: 1,
			width: 1920,
			height: 1080,
			gap: 12,
			expected: 1,
		},
		{
			count: 10,
			width: 1920,
			height: 1080,
			gap: 12,
			expected: 5,
		},
		{
			count: 60,
			width: 1920,
			height: 1080,
			gap: 12,
			expected: 12,
		},
		{
			count: 10,
			width: 1080,
			height: 1920,
			gap: 12,
			expected: 3,
		},
		{
			count: 3,
			width: 1920,
			height: 1080,
			gap: 12,
			expected: 3,
		},
		{
			count: 0,
			width: 1920,
			height: 1080,
			gap: 12,
			expected: 1,
		},
	])('fits $count cards on $width×$height in $expected columns', ({ expected, ...input }) => {
		expect(fitColumns(input)).toBe(expected);
	});

	// A label under each card takes height from every row, so taller rows win sooner.
	it('fits fewer rows when each card carries a label', () => {
		const input = {
			count: 12,
			width: 1920,
			height: 600,
			gap: 12,
		};

		expect(fitColumns({ ...input, labelHeight: 120 })).toBeGreaterThan(fitColumns(input));
	});

	// Paged, a page holds at most `maxRows` rows, and the page is what fills the space.
	it.each([
		{ count: 60, maxRows: 2, expected: 5 },
		{ count: 10, maxRows: 1, expected: 2 },
		{ count: 10, maxRows: 60, expected: 5 },
	])('fits $count cards, $maxRows rows a page, in $expected columns', ({ expected, ...input }) => {
		expect(fitColumns({
			...input,
			width: 1920,
			height: 1080,
			gap: 12,
		})).toBe(expected);
	});

	it.each([
		{
			width: 1920,
			cardWidth: 160,
			gap: 12,
			expected: 11,
		},
		{
			width: 2052,
			cardWidth: 160,
			gap: 12,
			expected: 12,
		},
		{
			width: 2051,
			cardWidth: 160,
			gap: 12,
			expected: 11,
		},
		{
			width: 100,
			cardWidth: 480,
			gap: 0,
			expected: 1,
		},
		{
			width: 9999,
			cardWidth: 48,
			gap: 0,
			expected: 12,
		},
	])('fits $expected $cardWidth px cards across $width px', ({ expected, ...input }) => {
		expect(fixedColumns(input)).toBe(expected);
	});

	// One continuous score: no threshold for a small change in size or gap to cross.
	it.each([
		{
			name: 'a layout filling its space with the largest cards',
			score: {
				cardWidth: 100,
				largestCardWidth: 100,
				widthShare: 1,
				heightShare: 1,
				slotFill: 1,
			},
			expected: 1,
		},
		{
			name: 'smaller cards, in proportion',
			score: {
				cardWidth: 90,
				largestCardWidth: 100,
				widthShare: 1,
				heightShare: 1,
				slotFill: 1,
			},
			expected: 0.9,
		},
		{
			name: 'a bare side, in full',
			score: {
				cardWidth: 100,
				largestCardWidth: 100,
				widthShare: 0.64,
				heightShare: 1,
				slotFill: 1,
			},
			expected: 0.64,
		},
		{
			name: 'a bare bottom, less',
			score: {
				cardWidth: 100,
				largestCardWidth: 100,
				widthShare: 1,
				heightShare: 0.64,
				slotFill: 1,
			},
			expected: 0.8,
		},
		{
			name: 'empty places in last rows',
			score: {
				cardWidth: 100,
				largestCardWidth: 100,
				widthShare: 1,
				heightShare: 1,
				slotFill: 0.75,
			},
			expected: 0.75,
		},
	])('scores $name', ({ score, expected }) => {
		expect(layoutScore(score)).toBeCloseTo(expected);
	});
});
