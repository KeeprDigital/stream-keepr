import type { OpCardColor } from './card/op';
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
 * A Feature Match Slot side's Leader: an inline snapshot of one Leader card,
 * taken from bandai-keepr when the operator picks it (ADR-0057). Its image is
 * the card's standard Printing.
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
}

export type PlayerGameData = MtgPlayerGameData | OpPlayerGameData;
