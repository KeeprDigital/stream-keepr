import type { MtgCardTimeoutData } from './mtg';

/** One Piece Card Game card data, as stream-keepr's bandai-keepr proxy answers it (ADR-0057). */

export const OP_CARD_CATEGORIES = [
	'leader',
	'character',
	'event',
	'stage',
] as const;
export type OpCardCategory = typeof OP_CARD_CATEGORIES[number];

/** bandai-keepr matches colours exactly, case included. */
export const OP_CARD_COLORS = [
	'Red',
	'Green',
	'Blue',
	'Purple',
	'Black',
	'Yellow',
] as const;
export type OpCardColor = typeof OP_CARD_COLORS[number];

export const OP_PRINTING_KINDS = ['standard', 'alt-art', 'reprint'] as const;
export type OpPrintingKind = typeof OP_PRINTING_KINDS[number];

/** A card behind a card number, imaged by the Printing its values come from (usually the standard one). */
export interface OpCardSummary {
	number: string;
	name: string;
	category: OpCardCategory;
	colors: string[];
	cost: number | null;
	life: number | null;
	power: number | null;
	counter: number | null;
	types: string[];
	effect: string | null;
	trigger: string | null;
	/** The Printing the Card's values come from: its standard Printing, or its lowest-id one. */
	printingId: string;
	imageUrl: string;
}

/**
 * A One Piece card as the card catalogue holds it (ADR-0074): what bandai-keepr
 * answered when its number was first looked up, imaged by its standard Printing.
 */
export interface OpCatalogueCard {
	name: string;
	category: OpCardCategory;
	colors: OpCardColor[];
	cost: number | null;
	power: number | null;
	counter: number | null;
	imageUrl: string;
}

/** One release of a Card: standard, alt-art or reprint, each with its own image. */
export interface OpPrinting {
	id: string;
	setId: string;
	kind: OpPrintingKind;
	rarity: string;
	imageUrl: string;
}

export interface OpCardDetail extends OpCardSummary {
	printings: OpPrinting[];
}

/** A search answer; `available: false` when this installation has no bandai-keepr configured. */
export type OpCardSearchAnswer
	= | { available: false }
		| { available: true; items: OpCardSummary[]; total: number };

/** A card-number lookup answer; `card` is `null` for a number bandai-keepr does not know. */
export type OpCardLookupAnswer
	= | { available: false }
		| { available: true; card: OpCardDetail | null };

/**
 * The One Piece variant of a Screen Card: one Printing of a Card. It has no
 * flip, rotate, turn-over or meld: an OP card is shown as printed.
 */
export interface OpScreenCard {
	game: 'op';
	/** The Printing id, e.g. `OP01-001_p1`. */
	id: string;
	/** The card number, e.g. `OP01-001`. */
	number: string;
	name: string;
	/** The Printing's Set. */
	set: string;
	printingKind: OpPrintingKind;
	imageUrl: string;
	timeoutData?: MtgCardTimeoutData;
}
