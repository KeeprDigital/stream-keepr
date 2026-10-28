import type { QuantityPosition } from '~~/shared/types/enums';

/**
 * Where a badge sits on a card image, as classes on the badge: at a corner or
 * an edge's midpoint, just over the card's edge. Every Screen Mode that badges
 * a card places its badges from these, so a position reads alike on each.
 */
export const CARD_BADGE_POSITION_CLASSES: Record<QuantityPosition, string> = {
	'top-left': '-top-1 -left-1',
	'top': '-top-1 left-1/2 -translate-x-1/2',
	'top-right': '-top-1 -right-1',
	'left': 'top-1/2 -left-1 -translate-y-1/2',
	'right': 'top-1/2 -right-1 -translate-y-1/2',
	'bottom-left': '-bottom-1 -left-1',
	'bottom': '-bottom-1 left-1/2 -translate-x-1/2',
	'bottom-right': '-bottom-1 -right-1',
};
