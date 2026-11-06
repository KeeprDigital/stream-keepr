import type { ScreenCard } from '../../types/card/mtg';
import type { OpCardColor, OpCardSummary, OpCatalogueCard, OpScreenCard } from '../../types/card/op';
import type { OpLeader } from '../../types/game';
import { OP_CARD_COLORS } from '../../types/card/op';

/** Where every One Piece Printing's image is served from, publicly. */
export const OP_CARD_IMAGE_ORIGIN = 'https://cards-img.keepr.digital';

/** A Printing's image: `cards-img.keepr.digital/<PrintingId>.png` (600×838 PNG). */
export function opPrintingImageUrl(printingId: string): string {
	return `${OP_CARD_IMAGE_ORIGIN}/${encodeURIComponent(printingId)}.png`;
}

/** Whether a URL is a One Piece Printing image, the only card image a broadcast loads. */
export function isOpCardImageUrl(value: string): boolean {
	try {
		return new URL(value).origin === OP_CARD_IMAGE_ORIGIN;
	}
	catch {
		return false;
	}
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

/** Lower-cased words, punctuation as breaks: `Monkey.D.Luffy` is `monkey`, `d`, `luffy`. */
function textWords(text: string): string[] {
	return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Whether a card answers text typed to find it: part of its card number, or
 * every word typed starting a word of its name, number or colours.
 */
export function opCardMatchesText(card: Pick<OpCardSummary, 'number' | 'name' | 'colors'>, text: string): boolean {
	const typed = text.trim();
	if (!typed)
		return false;
	if (card.number.toUpperCase().includes(typed.toUpperCase()))
		return true;
	const words = textWords([card.name, card.number, ...card.colors].join(' '));
	return textWords(typed).every(part => words.some(word => word.startsWith(part)));
}

/** Whether a Screen Card is the One Piece variant; an MTG card carries no `game`. */
export function isOpScreenCard(card: ScreenCard | null | undefined): card is OpScreenCard {
	return card != null && 'game' in card && card.game === 'op';
}

function isOpCardColor(value: string): value is OpCardColor {
	return (OP_CARD_COLORS as readonly string[]).includes(value);
}

/** A searched Leader as a Feature Match Slot side holds it, imaged by the Printing its values come from. */
export function opLeaderOf(card: OpCardSummary): OpLeader {
	return {
		number: card.number,
		name: card.name,
		colors: card.colors.filter(isOpCardColor),
		imageUrl: card.imageUrl,
	};
}

/** The catalogue's card numbered `number` as a Leader, imaged by its standard Printing (ADR-0074). */
export function catalogueOpLeader(number: string, card: OpCatalogueCard): OpLeader {
	return {
		number,
		name: card.name,
		colors: card.colors,
		imageUrl: card.imageUrl,
	};
}

/** One Piece colours as broadcast text, e.g. `Red/Green` for a dual-colour Leader. */
export function formatOpColors(colors: readonly OpCardColor[]): string {
	return colors.join('/');
}

/** The One Piece colours a `formatOpColors` text names; anything else is dropped. */
export function parseOpColors(text: string): OpCardColor[] {
	return text.split('/').map(part => part.trim()).filter(isOpCardColor);
}
