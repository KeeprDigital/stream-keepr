import type { OpCatalogueCard } from './card/op';
import type { OpDeckListEntry, OpDeckListView, OpDeckListWarning } from './opDeckList';

/**
 * A Feature Match Deck List: the One Piece Card Game Deck List one player side
 * of a Feature Match Slot holds, pasted by the operator (ADR-0057).
 */

/** The card behind an entry: the card catalogue's row for its number (ADR-0074). */
export type FeatureMatchDeckListCard = OpCatalogueCard;
export type FeatureMatchDeckListEntry = OpDeckListEntry;
export type FeatureMatchDeckListWarning = OpDeckListWarning;
export type FeatureMatchDeckListView = OpDeckListView;

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

/**
 * One card of a Commander Seat's Feature Match Deck List: the exact printing
 * its pasted line named (ADR-0087).
 */
export interface CommanderDeckListEntry {
	quantity: number;
	/** The printing, by its Scryfall id. */
	scryfallId: string;
	/** The card's full name: both faces' for a card with two. */
	name: string;
	setCode: string;
	collectorNumber: string | null;
	cardType: string | null;
	/** Colour identity letters in WUBRG order; empty for a colourless card. */
	colorIdentity: string;
	manaCost: string | null;
	manaValue: number | null;
}

/** A Commander Seat's saved Deck List: every card kept, the Seat's Commanders among them. */
export interface SavedCommanderDeckList {
	id: number;
	slotId: number;
	sourceText: string;
	entries: CommanderDeckListEntry[];
}

/** A paste as it would be saved, for its operator to confirm the Commanders of. */
export interface CommanderDeckListPreview {
	entries: CommanderDeckListEntry[];
	/** The printings offered as the Commanders, one or two, by Scryfall id. */
	offeredCommanders: string[];
	/** How many cards the dropped Sideboard held. */
	sideboardDropped: number;
}

/** Why a paste is refused: the line at fault, where one is. */
export interface CommanderDeckListRefusal {
	code: string;
	message: string;
	lineNumber?: number;
	sourceText?: string;
}

export type CommanderDeckListPreviewAnswer
	= | { ok: true; deckList: CommanderDeckListPreview }
		| { ok: false; errors: CommanderDeckListRefusal[] };

/** A save's answer, with the Slot it wrote. */
export interface SaveCommanderDeckListAnswer<TSlot> {
	deckList: SavedCommanderDeckList;
	featureMatch: TSlot;
}

/** The `data.code` of a refused save, which carries the refusals as `data.errors`. */
export const COMMANDER_DECK_LIST_INVALID = 'COMMANDER_DECK_LIST_INVALID';
