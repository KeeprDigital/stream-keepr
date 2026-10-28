/**
 * Scryfall CDN URL for a card's normal front face image, or null without a
 * Scryfall id.
 * Format: https://cards.scryfall.io/normal/front/{char1}/{char2}/{uuid}.jpg
 */
export function scryfallCardImageUrl(scryfallId: string | null | undefined): string | null {
	if (!scryfallId)
		return null;
	return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}
