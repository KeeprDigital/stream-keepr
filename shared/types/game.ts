import type { OpCardColor } from './card/op';
import type { FeatureMatchDeckListReference } from './featureMatchDeckList';
import type { FeatureMatchDefaults } from './featureMatchDefaults';

export interface CounterTypeConfig {
	key: string;
	label: string;
	shortLabel?: string;
	icon: string;
}

/**
 * The parts of Feature Match state a Card Game tracks beyond the clock, game
 * wins, turn number and the active and first player, which every Card Game
 * tracks. The Feature Match controls offer only what it tracks.
 */
export interface FeatureMatchStateTracking {
	life: boolean;
	mulligan: boolean;
	counters: boolean;
	overtime: boolean;
	/** Revealing the players' Sideboards; a One Piece Card Game Deck List has none. */
	sideboard: boolean;
}

export interface GameConfig {
	label: string;
	defaults: FeatureMatchDefaults;
	counterTypes: CounterTypeConfig[];
	startingTurnNumber: number;
	startingHandSize: number;
	playerIdentityLabel: string;
	tracks: FeatureMatchStateTracking;
}

// Game-specific player data (discriminated union on `type`)
export interface MtgPlayerGameData {
	type: 'mtg';
	deckName?: string | null;
	deckColors?: string | null;
}

/**
 * A Feature Match Slot side's Leader: one Leader card from the card catalogue,
 * imaged by its standard Printing. The side stores only its number and every
 * read fills in the rest from the catalogue (ADR-0074); a save is trusted for
 * the number alone.
 */
export interface OpLeader {
	number: string;
	name: string;
	/** One colour, or two for a dual-colour Leader. */
	colors: OpCardColor[];
	imageUrl: string;
}

export interface OpPlayerGameData {
	type: 'op';
	leader?: OpLeader | null;
	/**
	 * A Feature Match Slot side's Deck List, by reference: it travels with the
	 * side's player data, so it moves with its player on a swap (ADR-0057).
	 * The server owns its Mainboard count.
	 */
	featureMatchDeckList?: FeatureMatchDeckListReference | null;
}

export type PlayerGameData = MtgPlayerGameData | OpPlayerGameData;
