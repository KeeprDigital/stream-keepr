import type { OpCardCategory, OpCardColor } from './card/op';

/**
 * A Feature Match Deck List: the One Piece Card Game Deck List one player side
 * of a Feature Match Slot holds, pasted by the operator (ADR-0057).
 */

/** The card behind an entry, as bandai-keepr answered it when the Deck List was pasted. */
export interface FeatureMatchDeckListCard {
	name: string;
	category: OpCardCategory;
	colors: OpCardColor[];
	cost: number | null;
	power: number | null;
	counter: number | null;
	/** The card's standard Printing image. */
	imageUrl: string;
}

export interface FeatureMatchDeckListEntry {
	number: string;
	quantity: number;
	/** `null` for a number bandai-keepr does not know: a number-only placeholder. */
	card: FeatureMatchDeckListCard | null;
}

export type FeatureMatchDeckListWarning
	= | { code: 'MAINBOARD_COUNT'; message: string; count: number }
		| { code: 'TOO_MANY_COPIES'; message: string; number: string; quantity: number }
		| { code: 'NO_LEADER'; message: string }
		| { code: 'MULTIPLE_LEADERS'; message: string; numbers: string[] }
		| { code: 'OFF_COLOR'; message: string; numbers: string[] }
		| { code: 'UNKNOWN_CARD'; message: string; numbers: string[] };

/** A Deck List as a preview, or a saved one, shows it. */
export interface FeatureMatchDeckListView {
	/** Every pasted card in paste order, Leaders included; a number pasted twice is one entry. */
	entries: FeatureMatchDeckListEntry[];
	/** The card number of the Deck List's Leader: its first leader-category entry. */
	leaderNumber: string | null;
	/** Cards in the Mainboard: every entry but the Leaders, number-only ones included. */
	mainboardCount: number;
	/** Deck rule breaches. They never refuse a save. */
	warnings: FeatureMatchDeckListWarning[];
}

export interface SavedFeatureMatchDeckList extends FeatureMatchDeckListView {
	id: number;
	slotId: number;
	sourceText: string;
}

/**
 * What a side's slot data holds of its Deck List: the reference that moves
 * with the side's player, and the Mainboard count bindings read.
 */
export interface FeatureMatchDeckListReference {
	id: number;
	mainboardCount: number;
}

export type FeatureMatchDeckListPreviewAnswer
	= | { available: false }
		| { available: true; deckList: FeatureMatchDeckListView };

/** A save's answer, with the Slot it wrote: the server's response or the client's parsed one. */
export type SaveFeatureMatchDeckListAnswer<TSlot>
	= | { available: false }
		| { available: true; deckList: SavedFeatureMatchDeckList; featureMatch: TSlot };
