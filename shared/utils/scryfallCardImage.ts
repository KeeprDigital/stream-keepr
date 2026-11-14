/** Where every Scryfall card image is served from. */
const SCRYFALL_CARD_IMAGE_ORIGIN = 'https://cards.scryfall.io';

/** Whether a URL is a Scryfall card image, the only Magic card image a Feature Match Overlay loads. */
export function isScryfallCardImageUrl(value: string): boolean {
	try {
		return new URL(value).origin === SCRYFALL_CARD_IMAGE_ORIGIN;
	}
	catch {
		return false;
	}
}

/**
 * Scryfall CDN URL for a card's normal front face image, or null without a
 * Scryfall id.
 * Format: https://cards.scryfall.io/normal/front/{char1}/{char2}/{uuid}.jpg
 */
export function scryfallCardImageUrl(scryfallId: string | null | undefined): string | null {
	if (!scryfallId)
		return null;
	return `${SCRYFALL_CARD_IMAGE_ORIGIN}/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}
