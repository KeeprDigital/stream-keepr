import type { FeatureMatchDefaults } from './featureMatchDefaults';

export interface CounterTypeConfig {
	key: string;
	label: string;
	shortLabel?: string;
	icon: string;
}

export interface GameConfig {
	label: string;
	defaults: FeatureMatchDefaults;
	counterTypes: CounterTypeConfig[];
	startingTurnNumber: number;
	startingHandSize: number;
	playerIdentityLabel: string;
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
