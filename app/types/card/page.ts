export type CardPageMode = 'search' | 'match-decklist' | 'player-decklist';

/**
 * What the Cards page's matchup Deck Lists show: a Feature Match Slot, or a Match picked by Round.
 * Slot and Match ids come from different tables, so an id alone never says which.
 */
export interface CardMatchup {
	kind: 'slot' | 'match';
	id: number;
}

/** The id `matchup` names when it is of `kind`; a Slot id is never read as a Match id, nor the reverse. */
export function matchupIdOf(matchup: CardMatchup | null | undefined, kind: CardMatchup['kind']): number | null {
	return matchup?.kind === kind
		? matchup.id
		: null;
}
