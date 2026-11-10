import { describe, expect, it } from 'vitest';
import { AUTO_GAP_RATIO, CARD_ASPECT, fitColumns, fixedColumns, layoutScore, solveCardGrid } from '~~/shared/utils/cardGrid';

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

describe('solveCardGrid', () => {
	const COUNTS = [1, 2, 7, 10, 30, 60, 200];
	const CANVASES = [
		{ width: 1920, height: 1080 },
		{ width: 1080, height: 1920 },
		{ width: 3840, height: 600 },
		{ width: 640, height: 360 },
	];
	const COLUMNS = [null, 1, 4, 20];
	const MAX_CARD_WIDTHS = [null, 48, 160, 900];
	const GAPS = [null, 0, 12, 60];
	const cases = COUNTS.flatMap(count => CANVASES.flatMap(canvas => COLUMNS.flatMap(columns => MAX_CARD_WIDTHS.flatMap(maxCardWidth => GAPS.map(gap => ({
		count,
		...canvas,
		columns,
		maxCardWidth,
		gap,
	}))))));

	// The grid never leaves its space, a max card size holds, and a set column count is kept.
	// A set gap is kept until it would be wider than the cards it separates.
	it.each(cases)('lays $count cards on $width×$height within columns $columns, max $maxCardWidth, gap $gap', (input) => {
		const grid = solveCardGrid(input);

		expect(grid.cardWidth).toBeGreaterThan(0);
		expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(input.count);
		expect(grid.columns * grid.cardWidth + (grid.columns - 1) * grid.gap).toBeLessThanOrEqual(input.width + 1e-6);
		expect(grid.rows * grid.cardWidth / CARD_ASPECT + (grid.rows - 1) * grid.gap).toBeLessThanOrEqual(input.height + 1e-6);
		if (input.maxCardWidth !== null)
			expect(grid.cardWidth).toBeLessThanOrEqual(input.maxCardWidth);
		if (input.columns !== null)
			expect(grid.columns).toBe(input.columns);
		if (input.gap !== null)
			expect(grid.gap).toBeCloseTo(Math.min(input.gap, grid.cardWidth));
	});

	// The largest card that fits: one side of the grid reaches its space unless the max card size stops it.
	it.each(cases)('fills $width×$height with $count cards, columns $columns, max $maxCardWidth, gap $gap', (input) => {
		const grid = solveCardGrid(input);
		const widthLeft = input.width - (grid.columns * grid.cardWidth + (grid.columns - 1) * grid.gap);
		const heightLeft = input.height - (grid.rows * grid.cardWidth / CARD_ASPECT + (grid.rows - 1) * grid.gap);
		const atMax = input.maxCardWidth !== null && grid.cardWidth === input.maxCardWidth;

		expect(atMax || Math.min(widthLeft, heightLeft) < 1e-6).toBe(true);
	});

	it.each([
		{
			name: 'one card fills the height of a wide space',
			input: { count: 1, width: 1920, height: 850 },
			expected: { columns: 1, rows: 1, cardWidth: 610 },
		},
		{
			name: 'a set column count binds on the width',
			input: {
				count: 10,
				width: 1036,
				height: 5000,
				columns: 5,
				gap: 9,
			},
			expected: {
				columns: 5,
				rows: 2,
				cardWidth: 200,
				gap: 9,
			},
		},
		{
			name: 'a max card size leaves the rest of the space empty',
			input: {
				count: 3,
				width: 1920,
				height: 1080,
				maxCardWidth: 122,
			},
			expected: { columns: 3, rows: 1, cardWidth: 122 },
		},
		{
			name: 'Auto columns go past twelve when the cards are largest there',
			input: {
				count: 16,
				width: 3840,
				height: 300,
				gap: 0,
			},
			expected: { columns: 16, rows: 1 },
		},
		{
			name: 'a page of at most two rows',
			input: {
				count: 60,
				width: 1920,
				height: 1080,
				gap: 12,
				maxRows: 2,
			},
			expected: { columns: 5, rows: 2 },
		},
		{
			name: 'no cards',
			input: { count: 0, width: 1920, height: 1080 },
			expected: { columns: 1, rows: 1 },
		},
	])('solves $name', ({ input, expected }) => {
		expect(solveCardGrid(input)).toMatchObject(expected);
	});

	// Auto gap follows the card: today's 12 px beside a 160 px card, and in proportion at any other size.
	it.each([
		{ cardWidth: 160, gap: 12 },
		{ cardWidth: 80, gap: 6 },
		{ cardWidth: 400, gap: 30 },
	])('spaces $cardWidth px cards $gap px apart when gap is Auto', ({ cardWidth, gap }) => {
		const grid = solveCardGrid({
			count: 5,
			columns: 5,
			width: 5 * cardWidth + 4 * gap,
			height: 5000,
		});

		expect(grid.cardWidth).toBeCloseTo(cardWidth);
		expect(grid.gap).toBeCloseTo(gap);
		expect(AUTO_GAP_RATIO * 160).toBeCloseTo(12);
	});

	// A label under each card takes height from every row.
	it('leaves each row room for its label', () => {
		const grid = solveCardGrid({
			count: 2,
			columns: 1,
			width: 1920,
			height: 1000,
			gap: 0,
			labelHeight: 75,
		});

		expect(grid.cardWidth).toBeCloseTo(305);
	});
});
