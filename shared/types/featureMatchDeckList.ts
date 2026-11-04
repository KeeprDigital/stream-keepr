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
