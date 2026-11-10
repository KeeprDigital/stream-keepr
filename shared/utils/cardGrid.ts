/** A card image's width over its height. Keep in step with the `mtg-card` utility in main.css. */
export const CARD_ASPECT = 61 / 85;

/** The most columns a card grid lays out, auto or not. */
export const MAX_CARD_GRID_COLUMNS = 12;

function clampColumns(columns: number): number {
	return Math.min(MAX_CARD_GRID_COLUMNS, Math.max(1, columns));
}

export interface LayoutScoreInput {
	/** The layout's card width, and the largest any layout of the same cards in the same space reaches. */
	cardWidth: number;
	largestCardWidth: number;
	/** The share of the space's width and of its height the cards span, 0 to 1. */
	widthShare: number;
	heightShare: number;
	/** Cards over the places their rows hold, 0 to 1: empty places in last rows lower it. */
	slotFill: number;
}

/**
 * How well a card layout uses its space, 0 to 1: its card size, relative to
 * the largest possible, times the share of the width it spans, the square
 * root of the share of the height, and how full its rows are. Every term is a
 * ratio, so the same choice holds at any canvas, card or gap size, and the
 * score moves smoothly, with no threshold for a small change to cross. Width
 * counts more than height: space left under a layout reads as a margin, space
 * left beside it as a gap.
 */
export function layoutScore({ cardWidth, largestCardWidth, widthShare, heightShare, slotFill }: LayoutScoreInput): number {
	if (largestCardWidth <= 0 || cardWidth <= 0)
		return 0;
	return (cardWidth / largestCardWidth)
		* Math.min(1, widthShare)
		* Math.sqrt(Math.min(1, heightShare))
		* slotFill;
}

/** An Auto gap, as a share of the solved card width: 12 px beside a 160 px card. */
export const AUTO_GAP_RATIO = 12 / 160;

/**
 * A gap as `fixed + ratio × cardWidth`: a set gap is all fixed, an Auto gap
 * all ratio, so one formula sizes a card either way.
 */
export interface GapTerms {
	fixed: number;
	ratio: number;
}

export function gapTerms(gap: number | null | undefined, autoRatio: number = AUTO_GAP_RATIO): GapTerms {
	return typeof gap === 'number'
		? { fixed: Math.max(0, gap), ratio: 0 }
		: { fixed: 0, ratio: autoRatio };
}

export function gapAt(terms: GapTerms, cardWidth: number): number {
	return terms.fixed + terms.ratio * cardWidth;
}

/**
 * What a set gap gives way to once it would be wider than the cards it
 * separates: a gap of the card's own width, so the cards keep some of the space.
 */
export const GAP_AS_WIDE_AS_ITS_CARD: GapTerms = { fixed: 0, ratio: 1 };

/** The widest card at which `spans` cards and the gaps between them fit across `extent`. */
export function widestAcross(extent: number, spans: number, gap: GapTerms): number {
	return (extent - (spans - 1) * gap.fixed) / (spans + (spans - 1) * gap.ratio);
}

/** The widest card at which `rows` rows, each `labelHeight` taller than its card, fit down `extent`. */
export function widestDown(extent: number, rows: number, gap: GapTerms, labelHeight: number): number {
	return (extent - rows * labelHeight - (rows - 1) * gap.fixed) / (rows / CARD_ASPECT + (rows - 1) * gap.ratio);
}

export interface CardGridInput {
	count: number;
	/** The space the grid is given, in Event Canvas px. */
	width: number;
	height: number;
	/** A set column count, or Auto (absent): the count that uses the space best. */
	columns?: number | null;
	/** The widest a card may be, or Auto (absent): as wide as fits. */
	maxCardWidth?: number | null;
	/** A set gap in px, or Auto (absent): `AUTO_GAP_RATIO` of the solved card width. */
	gap?: number | null;
	/** The most rows a page of a paged grid holds. */
	maxRows?: number;
	/** Height a label takes under each card; 0 for none. */
	labelHeight?: number;
}

export interface CardGrid {
	columns: number;
	/** The rows of one page. */
	rows: number;
	cardWidth: number;
	gap: number;
}

interface ScoredCardGrid extends CardGrid {
	widthShare: number;
	heightShare: number;
	slotFill: number;
}

function gridAt(input: CardGridInput, columns: number): ScoredCardGrid {
	const { count, width, height, maxRows = Infinity, labelHeight = 0 } = input;
	const rows = Math.max(1, Math.min(Math.ceil(count / columns), maxRows));
	const widest = (terms: GapTerms) => Math.max(0, Math.min(
		widestAcross(width, columns, terms),
		widestDown(height, rows, terms, labelHeight),
		input.maxCardWidth ?? Infinity,
	));
	let terms = gapTerms(input.gap);
	let cardWidth = widest(terms);
	if (cardWidth < terms.fixed) {
		terms = GAP_AS_WIDE_AS_ITS_CARD;
		cardWidth = widest(terms);
	}
	const gap = gapAt(terms, cardWidth);
	return {
		columns,
		rows,
		cardWidth,
		gap,
		widthShare: (columns * cardWidth + (columns - 1) * gap) / width,
		heightShare: (rows * (cardWidth / CARD_ASPECT + labelHeight) + (rows - 1) * gap) / height,
		slotFill: Math.min(count, columns * rows) / (columns * rows),
	};
}

/** The best of 1 to `most` columns by `layoutScore`; of equal scores, the fewest. */
function bestGrid(input: CardGridInput, most: number): ScoredCardGrid {
	const grids = Array.from({
		length: Math.max(1, most),
	}, (_, index) => gridAt(input, index + 1));
	const largestCardWidth = Math.max(...grids.map(grid => grid.cardWidth));
	let best = grids[0]!;
	let bestScore = -Infinity;
	for (const grid of grids) {
		const score = layoutScore({ ...grid, largestCardWidth });
		if (score > bestScore) {
			best = grid;
			bestScore = score;
		}
	}
	return best;
}

/**
 * A card grid at the largest card size at which a page of it fits its space:
 * every column across `width`, every row down `height`. A set column count is
 * kept; Auto takes the count, from 1 to the card count, that uses the space
 * best (`layoutScore`). The card is never wider than a set max card size. A
 * set gap is kept while it is no wider than the card it leaves, and is the
 * card's width past that; an Auto gap is `AUTO_GAP_RATIO` of the solved card
 * width.
 */
export function solveCardGrid(input: CardGridInput): CardGrid {
	const { columns, rows, cardWidth, gap } = typeof input.columns === 'number'
		? gridAt(input, Math.max(1, Math.floor(input.columns)))
		: bestGrid(input, input.count);
	return {
		columns,
		rows,
		cardWidth,
		gap,
	};
}

/**
 * The column count, from 1 to `MAX_CARD_GRID_COLUMNS`, at which `count` cards
 * `gap` apart use their space best (`layoutScore`). It chooses only the count:
 * a Fit grid sizes its cards from the space it is given, so the area need only
 * be close.
 */
export function fitColumns(input: { count: number; width: number; height: number; gap: number; maxRows?: number; labelHeight?: number }): number {
	return bestGrid(input, clampColumns(input.count)).columns;
}

/** How many `cardWidth` cards, `gap` apart, fit across `width`. */
export function fixedColumns({ width, cardWidth, gap }: { width: number; cardWidth: number; gap: number }): number {
	return clampColumns(Math.floor((width + gap) / (cardWidth + gap)));
}
