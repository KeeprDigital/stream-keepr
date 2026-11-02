import type { Game } from '../types/enums';
import type { FeatureMatchDefaults } from '../types/featureMatchDefaults';
import type { CounterTypeConfig, FeatureMatchStateTracking, GameConfig } from '../types/game';
import { GAME_VALUES } from '../types/enums';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '../types/featureMatchDefaults';

export type { CounterTypeConfig, FeatureMatchStateTracking, Game, GameConfig };

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
		tracks: {
			life: true,
			mulligan: true,
			counters: true,
			overtime: true,
			sideboard: true,
		},
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
			// The turn and the active and first player are what an OP match tracks besides its clock and wins.
			turnTrackingEnabled: true,
			activePlayerTrackingEnabled: true,
			extraTurnsEnabled: false,
			extraTurns: 0,
		},
		counterTypes: [],
		startingTurnNumber: 1,
		startingHandSize: 5,
		playerIdentityLabel: 'Leader',
		// Life and DON!! tracking are deferred (ADR-0057).
		tracks: {
			life: false,
			mulligan: false,
			counters: false,
			overtime: false,
			sideboard: false,
		},
	},
};

/** Every Card Game: what something offered to any Event declares. */
export const EVERY_CARD_GAME: readonly Game[] = GAME_VALUES;

/**
 * Magic: The Gathering only: what something for Players, Rounds, Matches,
 * results or the Metagame declares, as a One Piece Card Game Event models none
 * of them (ADR-0057).
 */
export const MTG_ONLY: readonly Game[] = ['mtg'];

/**
 * Whether something declaring `cardGames` is offered to an Event of `game`.
 * Before the Event's Card Game is known, only what every Card Game supports is.
 */
export function isOfferedToCardGame(cardGames: readonly Game[], game: Game | undefined): boolean {
	return game === undefined
		? EVERY_CARD_GAME.every(cardGame => cardGames.includes(cardGame))
		: cardGames.includes(game);
}

/** The items offered to an Event of `game` (`isOfferedToCardGame`), their declarations dropped. */
export function offeredToCardGame<T extends { cardGames: readonly Game[] }>(items: readonly T[], game: Game | undefined): Omit<T, 'cardGames'>[] {
	return items
		.filter(item => isOfferedToCardGame(item.cardGames, game))
		.map(({ cardGames: _cardGames, ...item }) => item);
}

export function getGameConfig(game: Game): GameConfig {
	return GAME_CONFIGS[game];
}

export function getGameDefaults(game: Game): FeatureMatchDefaults {
	return {
		...(GAME_CONFIGS[game]?.defaults ?? DEFAULT_FEATURE_MATCH_DEFAULTS),
	};
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

const TRACKS_NOTHING_OPTIONAL: FeatureMatchStateTracking = {
	life: false,
	mulligan: false,
	counters: false,
	overtime: false,
	sideboard: false,
};

/** The parts of Feature Match state the Card Game tracks; none of the optional ones for a game with no config. */
export function getFeatureMatchStateTracking(game: Game): FeatureMatchStateTracking {
	return GAME_CONFIGS[game]?.tracks ?? TRACKS_NOTHING_OPTIONAL;
}

export function getPlayerIdentityLabel(game: Game): string {
	return GAME_CONFIGS[game]?.playerIdentityLabel ?? 'Deck';
}
