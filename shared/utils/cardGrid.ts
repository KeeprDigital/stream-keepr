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

/**
 * The column count at which `count` cards, in rows of that many, use their
 * space best (`layoutScore`): each count at the largest card size at which
 * every row of a page fits `height` and every column fits `width`. A paged
 * grid holds at most `maxRows` rows a page, and its page is what fills the
 * space. Of equal scores, the fewest columns win. It chooses only the count:
 * a Fit grid sizes its cards from the space it is given, so the area need only
 * be close.
 */
export function fitColumns({ count, width, height, gap, maxRows = Infinity, labelHeight = 0 }: { count: number; width: number; height: number; gap: number; maxRows?: number; labelHeight?: number }): number {
	const layouts = Array.from({
		length: clampColumns(count),
	}, (_, index) => {
		const columns = index + 1;
		const rows = Math.max(1, Math.min(Math.ceil(count / columns), maxRows));
		const cardWidth = Math.max(0, Math.min(
			(width - (columns - 1) * gap) / columns,
			((height - (rows - 1) * gap) / rows - labelHeight) * CARD_ASPECT,
		));
		const cardHeight = cardWidth / CARD_ASPECT;
		return {
			columns,
			cardWidth,
			widthShare: (columns * cardWidth + (columns - 1) * gap) / width,
			heightShare: (rows * (cardHeight + labelHeight) + (rows - 1) * gap) / height,
			slotFill: Math.min(count, columns * rows) / (columns * rows),
		};
	});
	const largestCardWidth = Math.max(...layouts.map(layout => layout.cardWidth));
	let best = 1;
	let bestScore = -Infinity;
	for (const layout of layouts) {
		const score = layoutScore({ ...layout, largestCardWidth });
		if (score > bestScore) {
			best = layout.columns;
			bestScore = score;
		}
	}
	return best;
}

/** How many `cardWidth` cards, `gap` apart, fit across `width`. */
export function fixedColumns({ width, cardWidth, gap }: { width: number; cardWidth: number; gap: number }): number {
	return clampColumns(Math.floor((width + gap) / (cardWidth + gap)));
}
