import type { DeckLayoutGridBoard, DeckLayoutInput, DeckLayoutStackBoard } from '~~/shared/utils/deckLayout';
import { describe, expect, it } from 'vitest';
import { CARD_ASPECT } from '~~/shared/utils/cardGrid';
import { MIN_STACK_REVEAL_SHARE, solveDeckLayout } from '~~/shared/utils/deckLayout';

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
});
