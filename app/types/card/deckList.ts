import type { DeckListCard, PlayerDeckList } from '~~/shared/types/deckList';
import type { CounterTypeConfig } from '~~/shared/types/game';
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
	deckCounters: CounterTypeConfig[];
	deckTokens: DeckTokenRequirement[];
	tokens: DeckListTokenWithData[];
	mainboard: DeckListCardWithData[];
	sideboard: DeckListCardWithData[];
}
