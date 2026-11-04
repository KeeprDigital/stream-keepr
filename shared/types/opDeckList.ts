import type { OpCatalogueCard } from './card/op';

/**
 * A One Piece Card Game Deck List: a Player's, or a Feature Match Slot side's
 * Feature Match Deck List (ADR-0074). Both are written by the OP Deck List
 * write and read through the same rules.
 */

export interface OpDeckListEntry {
	number: string;
	quantity: number;
	/** The card catalogue's card for the number; `null` for an Unresolved Deck Card, which bandai-keepr does not know. */
	card: OpCatalogueCard | null;
}

export type OpDeckListWarning
	= | { code: 'MAINBOARD_COUNT'; message: string; count: number }
		| { code: 'TOO_MANY_COPIES'; message: string; number: string; quantity: number }
		| { code: 'NO_LEADER'; message: string }
		| { code: 'MULTIPLE_LEADERS'; message: string; numbers: string[] }
		| { code: 'OFF_COLOR'; message: string; numbers: string[] }
		| { code: 'UNKNOWN_CARD'; message: string; numbers: string[] };

/** A Deck List as a preview, or a saved one, shows it. */
export interface OpDeckListView {
	/** Every card in entry order, Leaders included; a number entered twice is one entry. */
	entries: OpDeckListEntry[];
	/** The card number of the Deck List's Leader. */
	leaderNumber: string | null;
	/** Cards in the Mainboard: every entry but the Leaders, number-only ones included. */
	mainboardCount: number;
	/** Deck rule breaches. They never refuse a save. */
	warnings: OpDeckListWarning[];
}

/** A Player's Deck List as read: one per One Piece Card Game Player. */
export interface SavedOpPlayerDeckList extends OpDeckListView {
	/** A new id on every write, so a reader holding the old one knows to re-read. */
	id: number;
	playerId: number;
	/** Last written by hand rather than by a TCG+ Import, which then keeps it. */
	handEdited: boolean;
	/** The list in the paste format, Leader first, to edit from. */
	sourceText: string;
}

/**
 * What a One Piece Card Game Player's game data holds of their Deck List: its
 * id, which every write replaces, its Mainboard count, and its Leader's card
 * number, which the card catalogue names. The server owns it.
 */
export interface OpPlayerDeckListReference {
	id: number;
	mainboardCount: number;
	leaderNumber: string | null;
}

/** A Player Deck List write's answer: the saved Deck List, its warnings among it, and the Player. */
export interface WriteOpPlayerDeckListAnswer<TPlayer> {
	deckList: SavedOpPlayerDeckList;
	player: TPlayer;
}
