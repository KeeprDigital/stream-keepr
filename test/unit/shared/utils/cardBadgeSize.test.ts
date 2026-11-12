import { describe, expect, it } from 'vitest';
import { cardBadgeTextSize, DECK_AUTO_BADGE_RATIOS, TOP_CARDS_AUTO_BADGE_RATIO } from '~~/shared/utils/cardBadgeSize';

// An Auto badge follows its card: at its mode's former default card width it is
// the former default text size, so a Screen that never set one looks as it did.
// Auto keeps to a set size's bounds, 8 to 48 px; a set size is kept whatever the card's width.
describe('cardBadgeTextSize', () => {
	it.each([
		{
			name: 'a Most Played Cards badge at its former 160 px card',
			size: undefined,
			cardWidth: 160,
			ratio: TOP_CARDS_AUTO_BADGE_RATIO,
			px: 14,
		},
		{
			name: 'a Deck quantity badge at its former 144 px card',
			size: undefined,
			cardWidth: 144,
			ratio: DECK_AUTO_BADGE_RATIOS.quantityBadgeSize,
			px: 16,
		},
		{
			name: 'a Deck point badge at its former 144 px card',
			size: undefined,
			cardWidth: 144,
			ratio: DECK_AUTO_BADGE_RATIOS.pointsBadgeSize,
			px: 14,
		},
		{
			name: 'a Most Played Cards badge on a card twice as wide',
			size: undefined,
			cardWidth: 320,
			ratio: TOP_CARDS_AUTO_BADGE_RATIO,
			px: 28,
		},
		{
			name: 'a Deck quantity badge on a card half as wide',
			size: undefined,
			cardWidth: 72,
			ratio: DECK_AUTO_BADGE_RATIOS.quantityBadgeSize,
			px: 8,
		},
		{
			name: 'a Most Played Cards badge on an odd card width, to the hundredth',
			size: undefined,
			cardWidth: 237,
			ratio: TOP_CARDS_AUTO_BADGE_RATIO,
			px: 20.74,
		},
		{
			name: 'a Deck quantity badge on a card too narrow for 8 px',
			size: undefined,
			cardWidth: 48,
			ratio: DECK_AUTO_BADGE_RATIOS.quantityBadgeSize,
			px: 8,
		},
		{
			name: 'a Most Played Cards badge on a card too wide for 48 px',
			size: undefined,
			cardWidth: 1200,
			ratio: TOP_CARDS_AUTO_BADGE_RATIO,
			px: 48,
		},
		{
			name: 'a set size on a wide card',
			size: 20,
			cardWidth: 320,
			ratio: TOP_CARDS_AUTO_BADGE_RATIO,
			px: 20,
		},
		{
			name: 'a set size on a narrow card',
			size: 16,
			cardWidth: 72,
			ratio: DECK_AUTO_BADGE_RATIOS.quantityBadgeSize,
			px: 16,
		},
	])('sizes $name at $px px', ({ size, cardWidth, ratio, px }) => {
		expect(cardBadgeTextSize(size, cardWidth, ratio)).toBe(px);
	});
});
