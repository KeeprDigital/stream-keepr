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

export interface OpPlayerGameData {
	type: 'op';
	leader?: string | null;
}

export type PlayerGameData = MtgPlayerGameData | OpPlayerGameData;
