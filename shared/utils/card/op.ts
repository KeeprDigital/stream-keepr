import type { ScreenCard } from '~~/shared/types/card/mtg';
import type { OpScreenCard } from '~~/shared/types/card/op';

/** Where every One Piece Printing's image is served from, publicly. */
export const OP_CARD_IMAGE_ORIGIN = 'https://cards-img.keepr.digital';

/** A Printing's image: `cards-img.keepr.digital/<PrintingId>.png` (600×838 PNG). */
export function opPrintingImageUrl(printingId: string): string {
	return `${OP_CARD_IMAGE_ORIGIN}/${encodeURIComponent(printingId)}.png`;
}

/** A card number: a set code, a dash and three digits, e.g. `OP01-001`, `ST10-016`, `P-001`. */
const OP_CARD_NUMBER_PATTERN = /^[A-Z]{1,4}\d{0,2}-\d{3}$/;

/** The card number `input` names, upper-cased, or `null` when it is not one. */
export function parseOpCardNumber(input: string): string | null {
	const candidate = input.trim().toUpperCase();
	return OP_CARD_NUMBER_PATTERN.test(candidate)
		? candidate
		: null;
}

/** Whether a Screen Card is the One Piece variant; an MTG card carries no `game`. */
export function isOpScreenCard(card: ScreenCard | null | undefined): card is OpScreenCard {
	return card != null && 'game' in card && card.game === 'op';
}
