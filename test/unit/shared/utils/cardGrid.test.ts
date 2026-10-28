import { describe, expect, it } from 'vitest';
import { fitColumns, fixedColumns } from '~~/shared/utils/cardGrid';

describe('cardGrid', () => {
	// The columns at which the cards are largest while every row fits the height.
	it.each([
		{ count: 1, width: 1920, height: 1080, gap: 12, expected: 1 },
		{ count: 10, width: 1920, height: 1080, gap: 12, expected: 5 },
		{ count: 60, width: 1920, height: 1080, gap: 12, expected: 12 },
		{ count: 10, width: 1080, height: 1920, gap: 12, expected: 3 },
		{ count: 3, width: 1920, height: 1080, gap: 12, expected: 3 },
		{ count: 0, width: 1920, height: 1080, gap: 12, expected: 1 },
	])('fits $count cards on $width×$height in $expected columns', ({ expected, ...input }) => {
		expect(fitColumns(input)).toBe(expected);
	});

	it.each([
		{ width: 1920, cardWidth: 160, gap: 12, expected: 11 },
		{ width: 2052, cardWidth: 160, gap: 12, expected: 12 },
		{ width: 2051, cardWidth: 160, gap: 12, expected: 11 },
		{ width: 100, cardWidth: 480, gap: 0, expected: 1 },
		{ width: 9999, cardWidth: 48, gap: 0, expected: 12 },
	])('fits $expected $cardWidth px cards across $width px', ({ expected, ...input }) => {
		expect(fixedColumns(input)).toBe(expected);
	});
});
