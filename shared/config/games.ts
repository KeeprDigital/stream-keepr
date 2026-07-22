import type { Game } from '../types/enums';
import type { FeatureMatchDefaults } from '../types/featureMatchDefaults';
import type { CounterTypeConfig, GameConfig } from '../types/game';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '../types/featureMatchDefaults';

export type { CounterTypeConfig, Game, GameConfig };

export const GAME_CONFIGS: Record<Game, GameConfig> = {
	mtg: {
		label: 'Magic: The Gathering',
		defaults: {
			...DEFAULT_FEATURE_MATCH_DEFAULTS,
			bestOf: 3,
			startingLife: 20,
			clockDuration: 50,
			clockType: 'countdown',
			countUpAfterCountdown: true,
			extraTurnsEnabled: true,
			extraTurns: 5,
		},
		counterTypes: [
			{ key: 'poison', label: 'Poison', icon: 'i-mdi-skull' },
			{ key: 'energy', label: 'Energy', icon: 'i-mdi-lightning-bolt' },
			{ key: 'storm', label: 'Storm', icon: 'i-mdi-weather-lightning' },
			{ key: 'experience', label: 'Experience', icon: 'i-mdi-star-four-points' },
			{ key: 'rad', label: 'Rad', icon: 'i-mdi-radioactive' },
		],
		startingTurnNumber: 0,
		startingHandSize: 7,
		playerIdentityLabel: 'Deck',
	},
	op: {
		label: 'One Piece',
		defaults: {
			...DEFAULT_FEATURE_MATCH_DEFAULTS,
			bestOf: 1,
			startingLife: 0,
			clockDuration: 30,
			clockType: 'countdown',
			countUpAfterCountdown: false,
			extraTurnsEnabled: false,
			extraTurns: 0,
		},
		counterTypes: [],
		startingTurnNumber: 1,
		startingHandSize: 0,
		playerIdentityLabel: 'Leader',
	},
};

export function getGameConfig(game: Game): GameConfig {
	return GAME_CONFIGS[game];
}

export function getGameDefaults(game: Game): FeatureMatchDefaults {
	return { ...(GAME_CONFIGS[game]?.defaults ?? DEFAULT_FEATURE_MATCH_DEFAULTS) };
}

export function getCounterTypeConfigs(game: Game): CounterTypeConfig[] {
	return GAME_CONFIGS[game]?.counterTypes ?? [];
}

export function getStartingTurnNumber(game: Game): number {
	return GAME_CONFIGS[game]?.startingTurnNumber ?? 0;
}

export function getStartingHandSize(game: Game): number {
	return GAME_CONFIGS[game]?.startingHandSize ?? 0;
}

export function getPlayerIdentityLabel(game: Game): string {
	return GAME_CONFIGS[game]?.playerIdentityLabel ?? 'Deck';
}
