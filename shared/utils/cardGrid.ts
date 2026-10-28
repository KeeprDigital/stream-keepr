/** A card image's width over its height. Keep in step with the `mtg-card` utility in main.css. */
export const CARD_ASPECT = 61 / 85;

/** The most columns a card grid lays out, auto or not. */
export const MAX_CARD_GRID_COLUMNS = 12;

function clampColumns(columns: number): number {
	return Math.min(MAX_CARD_GRID_COLUMNS, Math.max(1, columns));
}

/**
 * The column count at which `count` cards, in rows of that many, are largest
 * while every row fits `height` and every column fits `width`. A tie keeps the
 * fewer columns. It chooses only the count: a Fit grid sizes its cards from the
 * space it is given, so the area need only be close.
 */
export function fitColumns({ count, width, height, gap }: { count: number; width: number; height: number; gap: number }): number {
	let best = 1;
	let bestWidth = -Infinity;
	for (let columns = 1; columns <= clampColumns(count); columns++) {
		const rows = Math.ceil(count / columns);
		const cardWidth = Math.min(
			(width - (columns - 1) * gap) / columns,
			((height - (rows - 1) * gap) / rows) * CARD_ASPECT,
		);
		if (cardWidth > bestWidth) {
			best = columns;
			bestWidth = cardWidth;
		}
	}
	return best;
}

/** How many `cardWidth` cards, `gap` apart, fit across `width`. */
export function fixedColumns({ width, cardWidth, gap }: { width: number; cardWidth: number; gap: number }): number {
	return clampColumns(Math.floor((width + gap) / (cardWidth + gap)));
}
