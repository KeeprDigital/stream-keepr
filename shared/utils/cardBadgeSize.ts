// A card badge's size is its text size; the badge is laid out around it in em
// (ADR-0054). Auto, a size stored as absent, is a fixed share of the card's
// solved width: the share that gives the badge's former default text size at
// its mode's former default card width, as an Auto gap gives its former gap.

/** A Most Played Cards badge's Auto text size per px of card width: 14 px on a 160 px card. */
export const TOP_CARDS_AUTO_BADGE_RATIO = 14 / 160;

/** A Deck List badge's Auto text size per px of card width, by its size field: 16 px and 14 px on a 144 px card. */
export const DECK_AUTO_BADGE_RATIOS = {
	quantityBadgeSize: 16 / 144,
	pointsBadgeSize: 14 / 144,
} as const;

/** A badge's text size in px: its set size, or Auto's share of its card's width, to the hundredth. */
export function cardBadgeTextSize(size: number | undefined, cardWidth: number, autoRatio: number): number {
	return size ?? Math.round(cardWidth * autoRatio * 100) / 100;
}
