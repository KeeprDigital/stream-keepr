import type { PlayerSide } from './enums';

/**
 * A One Piece Card Game Unresolved Deck Card (ADR-0074): a card number
 * bandai-keepr did not know, held number-only by Deck Lists across the Event.
 */

/** Who holds a Deck List: a Player, or a Slot side with its own Feature Match Deck List. */
export type OpUnresolvedDeckCardHolder
	= | { kind: 'player'; playerId: number; name: string }
		/** A side in the Slot's own order, named as its slot data names it. */
		| { kind: 'slotSide'; slotId: number; side: PlayerSide; name: string };

export interface OpUnresolvedDeckCardDeckList {
	holder: OpUnresolvedDeckCardHolder;
	quantity: number;
	/** The number is this Deck List's Leader. */
	asLeader: boolean;
}

export interface OpUnresolvedDeckCard {
	number: string;
	/** Copies across every Deck List holding the number. */
	copies: number;
	deckLists: OpUnresolvedDeckCardDeckList[];
}

/** What a retry or a resolution did: the card the number now names, if any, and how many Deck Lists it rewrote. */
export interface OpUnresolvedDeckCardAnswer {
	number: string;
	/** The card the Deck Lists now hold; `null` when a retry found bandai-keepr still does not know the number. */
	card: { number: string; name: string } | null;
	rewritten: number;
}
