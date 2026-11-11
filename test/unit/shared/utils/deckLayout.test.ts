import type { DeckLayoutGridBoard, DeckLayoutInput, DeckLayoutStackBoard } from '~~/shared/utils/deckLayout';
import { describe, expect, it } from 'vitest';
import { CARD_ASPECT } from '~~/shared/utils/cardGrid';
import { MIN_STACK_REVEAL_SHARE, solveDeckGroups, solveDeckLayout } from '~~/shared/utils/deckLayout';

function grid(count: number, columns: number | null = null, labelHeight = 0): DeckLayoutGridBoard {
	return {
		view: 'grid',
		count,
		gap: 8,
		columns,
		labelHeight,
	};
}

function stack(count: number, reveal = 30): DeckLayoutStackBoard {
	return {
		view: 'stack',
		count,
		reveal,
		labelHeight: 36,
	};
}

function space(input: Partial<DeckLayoutInput>): DeckLayoutInput {
	return {
		width: 1920,
		height: 960,
		boardGap: 24,
		placement: 'beside',
		mainboard: null,
		sideboard: null,
		...input,
	};
}

/** How far a solved layout reaches across and down: the boards beside or below each other. */
function extent(input: DeckLayoutInput) {
	const layout = solveDeckLayout(input)!;
	const boards = [layout.mainboard, layout.sideboard].filter(board => board !== null);
	const between = boards.length > 1
		? input.boardGap
		: 0;
	return input.placement === 'beside'
		? {
				width: boards.reduce((sum, board) => sum + board.width, 0) + between,
				height: Math.max(...boards.map(board => board.height)),
			}
		: {
				width: Math.max(...boards.map(board => board.width)),
				height: boards.reduce((sum, board) => sum + board.height, 0) + between,
			};
}

describe('solveDeckLayout', () => {
	// Every board shares one card size, and together they fit the space they share.
	it.each([
		{
			name: 'a grid beside a stack',
			input: space({
				mainboard: grid(23),
				sideboard: stack(15),
			}),
		},
		{
			name: 'two grids beside each other',
			input: space({
				mainboard: grid(23),
				sideboard: grid(15, null, 36),
			}),
		},
		{
			name: 'two grids, one below the other',
			input: space({
				placement: 'below',
				mainboard: grid(23),
				sideboard: grid(15, null, 36),
			}),
		},
		{
			name: 'a mainboard alone',
			input: space({
				mainboard: grid(40),
			}),
		},
	])('fits $name inside its space', ({ input }) => {
		const { width, height } = extent(input);

		expect(width).toBeLessThanOrEqual(input.width + 0.001);
		expect(height).toBeLessThanOrEqual(input.height + 0.001);
	});

	it('gives the mainboard and sideboard one card size', () => {
		const layout = solveDeckLayout(space({
			mainboard: grid(23),
			sideboard: stack(15),
		}))!;

		expect(layout.sideboard!.width).toBe(layout.cardWidth);
		expect(layout.mainboard!.width).toBeCloseTo(layout.mainboard!.columns * layout.cardWidth + (layout.mainboard!.columns - 1) * 8);
	});

	// A stack shows less of each card before its cards shrink, never less than the name bar.
	it.each([
		{ name: 'keeps the set reveal while it fits', height: 1400, compressed: false },
		{ name: 'shows less of each card where the set reveal would not fit', height: 700, compressed: true },
	])('$name', ({ height, compressed }) => {
		const layout = solveDeckLayout(space({
			height,
			mainboard: grid(23, 8),
			sideboard: stack(15, 60),
		}))!;
		const reveal = layout.sideboard!.view === 'stack'
			? layout.sideboard!.reveal
			: NaN;

		expect(reveal < 60).toBe(compressed);
		expect(reveal).toBeGreaterThanOrEqual(MIN_STACK_REVEAL_SHARE * (layout.cardWidth / CARD_ASPECT) - 0.001);
	});

	// Full last rows score higher, so near-equal card sizes go to the fuller rows.
	it.each([
		{ count: 13, columns: 7 },
		{ count: 12, columns: 6 },
	])('lays $count cards out in $columns columns', ({ count, columns }) => {
		expect(solveDeckLayout(space({
			mainboard: grid(count),
		}))!.mainboard!.columns).toBe(columns);
	});

	// A sideboard under the mainboard is never wider than it, so the deck reads as one block.
	it.each([
		{
			main: 21,
			side: 9,
			width: 1800,
			height: 990,
		},
		{
			main: 21,
			side: 9,
			width: 1920,
			height: 960,
		},
		{
			main: 23,
			side: 15,
			width: 1920,
			height: 960,
		},
		{
			main: 12,
			side: 15,
			width: 1920,
			height: 960,
		},
	])('lays $side sideboard cards below $main no wider than the mainboard, in $width×$height', ({ main, side, width, height }) => {
		const layout = solveDeckLayout(space({
			width,
			height,
			placement: 'below',
			mainboard: grid(main),
			sideboard: grid(side, null, 36),
		}))!;

		expect(layout.sideboard!.view === 'grid' && layout.sideboard!.columns).toBeLessThanOrEqual(layout.mainboard!.columns);
	});

	// At any gap the deck spans the width: wider gaps trade a column for a row, never a bare side.
	it.each([0, 8, 16, 24, 32, 40, 48].map(gap => ({ gap, height: 920 })))('spreads a deck across the space rather than leaving it empty beside it, $gap px apart', ({ gap, height }) => {
		const input = space({
			width: 1880,
			height,
			placement: 'below',
			mainboard: {
				...grid(23),
				gap,
			},
			sideboard: {
				...grid(8, null, 36),
				gap,
			},
		});
		const layout = solveDeckLayout(input)!;

		expect(Math.max(layout.mainboard!.width, layout.sideboard!.width) / input.width).toBeGreaterThan(0.9);
		expect(layout.sideboard!.view === 'grid' && layout.sideboard!.rows).toBe(1);
	});

	it('keeps a board\'s own column count', () => {
		expect(solveDeckLayout(space({
			mainboard: grid(23, 4),
			sideboard: stack(15),
		}))!.mainboard!.columns).toBe(4);
	});

	it.each([
		{
			name: 'no boards',
			input: space({}),
		},
		{
			name: 'an unmeasured space',
			input: space({
				width: 0,
				height: 0,
				mainboard: grid(10),
			}),
		},
	])('lays out nothing for $name', ({ input }) => {
		expect(solveDeckLayout(input)).toBeNull();
	});
	const CONSTRAINED = [
		{ main: 1, side: 0 },
		{ main: 23, side: 15 },
		{ main: 100, side: 15 },
	].flatMap(counts => [
		{ width: 1920, height: 960 },
		{ width: 1080, height: 1800 },
		{ width: 640, height: 300 },
	].flatMap(canvas => (['beside', 'below'] as const).flatMap(placement => [null, 3, 20].flatMap(columns => [null, 48, 144, 900].flatMap(maxCardWidth => [null, 0, 8, 60].map(gap => ({
		...counts,
		...canvas,
		placement,
		columns,
		maxCardWidth,
		gap,
	})))))));

	function constrained({ main, side, width, height, placement, columns, maxCardWidth, gap }: typeof CONSTRAINED[number]): DeckLayoutInput {
		return space({
			width,
			height,
			placement,
			mainboard: {
				...grid(main, columns),
				gap,
				maxCardWidth,
			},
			sideboard: side > 0
				? {
						...grid(side, null, 36),
						gap,
					}
				: null,
		});
	}

	// The deck never leaves its space, a max card size holds, and a set column count is kept.
	// A set gap is kept until it would be wider than the cards it separates.
	it.each(CONSTRAINED)('lays $main and $side cards $placement in $width×$height within columns $columns, max $maxCardWidth, gap $gap', (row) => {
		const input = constrained(row);
		const layout = solveDeckLayout(input)!;
		const { width, height } = extent(input);

		expect(layout.cardWidth).toBeGreaterThan(0);
		expect(width).toBeLessThanOrEqual(input.width + 0.001);
		expect(height).toBeLessThanOrEqual(input.height + 0.001);
		expect(layout.mainboard!.width).toBeCloseTo(layout.mainboard!.columns * layout.cardWidth + (layout.mainboard!.columns - 1) * layout.mainboard!.gap);
		if (row.maxCardWidth !== null)
			expect(layout.cardWidth).toBeLessThanOrEqual(row.maxCardWidth);
		if (row.columns !== null)
			expect(layout.mainboard!.columns).toBe(row.columns);
		if (row.gap !== null)
			expect(layout.mainboard!.gap).toBeCloseTo(Math.min(row.gap, layout.cardWidth));
	});

	// The largest card that fits: the deck reaches one side of its space unless the max card size stops it.
	it.each(CONSTRAINED)('fills $width×$height with $main and $side cards $placement, columns $columns, max $maxCardWidth, gap $gap', (row) => {
		const input = constrained(row);
		const layout = solveDeckLayout(input)!;
		const { width, height } = extent(input);
		const atMax = row.maxCardWidth !== null && layout.cardWidth === row.maxCardWidth;

		expect(atMax || Math.min(input.width - width, input.height - height) < 0.001).toBe(true);
	});

	// Auto gap follows the card: today's 8 px beside a 144 px card, and in proportion at any other size.
	it.each([
		{ cardWidth: 144, gap: 8 },
		{ cardWidth: 72, gap: 4 },
		{ cardWidth: 288, gap: 16 },
	])('spaces $cardWidth px cards $gap px apart when gap is Auto', ({ cardWidth, gap }) => {
		const layout = solveDeckLayout(space({
			width: 4 * cardWidth + 3 * gap,
			height: 5000,
			mainboard: {
				...grid(4, 4),
				gap: null,
			},
		}))!;

		expect(layout.cardWidth).toBeCloseTo(cardWidth);
		expect(layout.mainboard!.gap).toBeCloseTo(gap);
	});

	// The strip is one mainboard column wide, so the mainboard's max card size holds it too.
	it('holds a stacked sideboard to the mainboard\'s max card size', () => {
		const layout = solveDeckLayout(space({
			mainboard: {
				...grid(23),
				maxCardWidth: 100,
			},
			sideboard: stack(15),
		}))!;

		expect(layout.cardWidth).toBe(100);
		expect(layout.sideboard!.width).toBe(100);
	});

	// Columns follow the card count, not a constant.
	it('chooses more than twelve columns where the cards are largest there', () => {
		expect(solveDeckLayout(space({
			width: 3840,
			height: 300,
			mainboard: grid(16),
		}))!.mainboard!.columns).toBe(16);
	});
});

describe('solveDeckLayout with a stacked sideboard\'s own max card size', () => {
	// Every board shares one card size, so the strip's max holds the mainboard too.
	it('holds every board to the stacked sideboard\'s max card size', () => {
		const layout = solveDeckLayout(space({
			mainboard: grid(23),
			sideboard: {
				...stack(15),
				maxCardWidth: 60,
			},
		}))!;

		expect(layout.cardWidth).toBe(60);
		expect(layout.sideboard!.width).toBe(60);
	});
});

describe('solveDeckGroups', () => {
	const GROUPS = [
		[1],
		[12, 3, 1],
		[30, 8],
		[4, 4, 4, 4],
		[0],
	];
	const SPACES = [
		{ width: 1300, height: 900 },
		{ width: 600, height: 1700 },
		{ width: 3000, height: 500 },
	];
	const COLUMNS = [null, 1, 6, 20];
	const MAX_CARD_WIDTHS = [null, 48, 144];
	const GAPS = [null, 0, 8, 60];
	const cases = GROUPS.flatMap(counts => SPACES.flatMap(area => COLUMNS.flatMap(columns => MAX_CARD_WIDTHS.flatMap(maxCardWidth => GAPS.map(gap => ({
		counts,
		...area,
		columns,
		maxCardWidth,
		gap,
		labelHeight: 36,
		groupGap: 16,
	}))))));

	function heightOf(input: typeof cases[number]) {
		const groups = solveDeckGroups(input);
		return groups.rows.reduce((sum, rows) => sum + input.labelHeight + rows * groups.cardWidth / CARD_ASPECT + (rows - 1) * groups.gap, 0)
			+ (groups.rows.length - 1) * input.groupGap;
	}

	// The groups never leave their space, a max card size holds, and a set column count is kept.
	it.each(cases)('lays groups of $counts in $width×$height within columns $columns, max $maxCardWidth, gap $gap', (input) => {
		const groups = solveDeckGroups(input);

		expect(groups.cardWidth).toBeGreaterThan(0);
		expect(groups.rows).toHaveLength(input.counts.length);
		input.counts.forEach((count, index) => expect(groups.columns * groups.rows[index]!).toBeGreaterThanOrEqual(count));
		expect(groups.columns * groups.cardWidth + (groups.columns - 1) * groups.gap).toBeLessThanOrEqual(input.width + 1e-6);
		expect(heightOf(input)).toBeLessThanOrEqual(input.height + 1e-6);
		if (input.maxCardWidth !== null)
			expect(groups.cardWidth).toBeLessThanOrEqual(input.maxCardWidth);
		if (input.columns !== null)
			expect(groups.columns).toBe(input.columns);
		if (input.gap !== null)
			expect(groups.gap).toBeCloseTo(Math.min(input.gap, groups.cardWidth));
	});

	// The largest card that fits: one side reaches its space unless the max card size stops it.
	it.each(cases)('fills $width×$height with groups of $counts, columns $columns, max $maxCardWidth, gap $gap', (input) => {
		const groups = solveDeckGroups(input);
		const widthLeft = input.width - (groups.columns * groups.cardWidth + (groups.columns - 1) * groups.gap);
		const atMax = input.maxCardWidth !== null && groups.cardWidth === input.maxCardWidth;

		expect(atMax || Math.min(widthLeft, input.height - heightOf(input)) < 1e-6).toBe(true);
	});

	it('gives every group the one column count and card size a worked space holds', () => {
		// Two groups of 4 and 2 in 3 columns: rows 2 and 1, so 3 card heights of 170 px, 2 headings, 1 row gap and 1 group gap.
		const groups = solveDeckGroups({
			counts: [4, 2],
			width: 5000,
			height: 3 * 170 + 2 * 30 + 10 + 20,
			columns: 3,
			gap: 10,
			labelHeight: 30,
			groupGap: 20,
		});

		expect(groups).toMatchObject({
			columns: 3,
			rows: [2, 1],
			gap: 10,
		});
		expect(groups.cardWidth).toBeCloseTo(122);
	});
});
