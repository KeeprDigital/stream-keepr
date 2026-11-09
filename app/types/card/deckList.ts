import type { DeckListCard, PlayerDeckList } from '~~/shared/types/deckList';
import type { OpLeader } from '~~/shared/types/game';
import type { OpDeckListView } from '~~/shared/types/opDeckList';
import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import type { MtgCard } from '~/types/card/mtg';

/** A deck list card enriched with Scryfall card data */
export interface DeckListCardWithData extends DeckListCard {
	mtgCard: MtgCard | null;
}

/** A derived token card enriched with Scryfall card data when available */
export interface DeckListTokenWithData extends DeckTokenRequirement {
	mtgCard: MtgCard | null;
}

/** Full deck data for one player in a match */
export interface MatchPlayerDeckData {
	playerName: string;
	deckList: PlayerDeckList | null;
	deckTokens: DeckTokenRequirement[];
	tokens: DeckListTokenWithData[];
	mainboard: DeckListCardWithData[];
	sideboard: DeckListCardWithData[];
	companion: DeckListCardWithData | null;
}

/**
 * Who one side of a Feature Match Slot seats on a One Piece Card Game Event,
 * and the Deck List the side holds: its own Feature Match Deck List, or its
 * linked Player's (ADR-0057, ADR-0074).
 */
export interface OpMatchPlayerDeckData {
	playerName: string;
	/** The linked Player; `null` for manual slot data. */
	playerId: number | null;
	leader: OpLeader | null;
	/** `null` while the side holds no Deck List, or its read failed. */
	deckList: OpDeckListView | null;
	/** The side holds a Deck List that could not be read. */
	failed: boolean;
}
