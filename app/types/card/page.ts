export type CardPageMode = 'search' | 'match-decklist' | 'player-decklist';

/**
 * What the Cards page's matchup Deck Lists show: a Feature Match Slot, or a Match picked by Round.
 * Slot and Match ids come from different tables, so an id alone never says which.
 */
export interface CardDeckListSource {
	kind: 'slot' | 'match';
	id: number;
}
