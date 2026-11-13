import type { Game, ScreenMode, Variant } from '../types/enums';
import type { FeatureMatchDefaults } from '../types/featureMatchDefaults';
import type { CounterTypeConfig, FeatureMatchStateTracking, GameConfig, MetagameRules } from '../types/game';
import { METAGAME_SCOPE_VALUES } from '../types/enums';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '../types/featureMatchDefaults';

export type { CounterTypeConfig, FeatureMatchStateTracking, Game, GameConfig, MetagameRules };

/** A Metagame with no standings: every Player or a Player List, counted by participation. */
const PARTICIPATION_ONLY: MetagameRules = {
	scopes: ['all', 'playerList'],
	readsStandings: false,
};

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
		metagame: {
			scopes: METAGAME_SCOPE_VALUES,
			readsStandings: true,
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
		// TCG+ exports Deck Lists but no standings (ADR-0074).
		metagame: PARTICIPATION_ONLY,
	},
};

/**
 * The kinds of Event something is offered to: an Event's Card Game, with Magic:
 * The Gathering split by its Variant, as a Commander Event holds no Players,
 * Rounds or Matches (ADR-0087). A key for declarations and config only: the
 * domain's own terms are Card Game and Variant. No kind shares a Card Game's
 * key, so a Card Game cannot be passed where the Variant must be read too.
 */
export const EVENT_KIND_VALUES = ['mtg-two-player', 'mtg-commander', 'op'] as const;
export type EventKind = typeof EVENT_KIND_VALUES[number];

/** The Card Game an Event of each kind is played in. */
const EVENT_KIND_CARD_GAME: Record<EventKind, Game> = {
	'mtg-two-player': 'mtg',
	'mtg-commander': 'mtg',
	'op': 'op',
};

/** Whether a Card Game's Events have a Variant: Magic: The Gathering's alone (ADR-0087). */
export function cardGameHasVariant(game: Game): boolean {
	return game === 'mtg';
}

/** The kind of Event its Card Game and Variant make it; a Magic: The Gathering Event is Two-Player unless it says Commander. */
export function eventKind(event: { game: Game; variant?: Variant | null }): EventKind {
	if (!cardGameHasVariant(event.game))
		return event.game as Exclude<Game, 'mtg'>;
	return event.variant === 'commander'
		? 'mtg-commander'
		: 'mtg-two-player';
}

/** Every Event: what needs neither Players nor results declares. */
export const EVERY_EVENT: readonly EventKind[] = EVENT_KIND_VALUES;

/**
 * Events that hold Players: every one but a Commander Event, which is produced
 * from its Feature Match Slots alone (ADR-0087).
 */
export const EVENTS_WITH_PLAYERS: readonly EventKind[] = ['mtg-two-player', 'op'];

/**
 * Two-Player Magic: The Gathering only: what something for Rounds, Matches,
 * results or Melee Sync declares, as neither a One Piece Card Game Event
 * (ADR-0057) nor a Commander Event (ADR-0087) models any of them.
 */
export const TWO_PLAYER_MAGIC_ONLY: readonly EventKind[] = ['mtg-two-player'];

/**
 * The Events each Event page is offered to, read by its page guard, the Event
 * nav and the settings tabs alike. A One Piece Card Game Event has Players,
 * and a Sync page that runs its TCG+ Import (ADR-0074), but no Rounds, Matches
 * or Melee Sync (ADR-0057). A Commander Event has no Players either, and keeps
 * the Cards page alone (ADR-0087).
 */
export const EVENT_PAGE_OFFERED_TO = {
	players: EVENTS_WITH_PLAYERS,
	matches: TWO_PLAYER_MAGIC_ONLY,
	eventStructure: TWO_PLAYER_MAGIC_ONLY,
	sync: EVENTS_WITH_PLAYERS,
	metagame: EVENTS_WITH_PLAYERS,
	archetypeReview: TWO_PLAYER_MAGIC_ONLY,
	cards: EVERY_EVENT,
	integrations: TWO_PLAYER_MAGIC_ONLY,
} as const satisfies Record<string, readonly EventKind[]>;

/**
 * The Events each Screen Mode is offered to, read by its Screen Mode
 * Definition. A One Piece Card Game Event's Metagame reads participation only
 * (ADR-0074), so the modes needing results or standings stay Two-Player
 * Magic's. Top Cut Bracket is offered to both, since its Manual Bracket needs
 * neither (ADR-0075). A Commander Event is offered only the modes that need
 * no Players (ADR-0087).
 */
export const SCREEN_MODE_OFFERED_TO = {
	'background': EVERY_EVENT,
	'card': EVERY_EVENT,
	'deck': EVERY_EVENT,
	'standings': TWO_PLAYER_MAGIC_ONLY,
	'top-cut': EVENTS_WITH_PLAYERS,
	'feature-match': EVERY_EVENT,
	'feature-match-overlay': EVERY_EVENT,
	'broadcast-graphics': EVERY_EVENT,
	'metagame': EVENTS_WITH_PLAYERS,
	'top-cards': EVENTS_WITH_PLAYERS,
	'player-history': TWO_PLAYER_MAGIC_ONLY,
	'pairings': TWO_PLAYER_MAGIC_ONLY,
	'archetype-spotlight': EVENTS_WITH_PLAYERS,
	'head-to-head': TWO_PLAYER_MAGIC_ONLY,
	'round-clock': TWO_PLAYER_MAGIC_ONLY,
	'talent': EVERY_EVENT,
} as const satisfies Record<ScreenMode, readonly EventKind[]>;

/**
 * Whether something declaring `offeredTo` is offered to an Event of `kind`.
 * Before the Event is known, only what every Event is offered is.
 */
export function isOfferedToEvent(offeredTo: readonly EventKind[], kind: EventKind | undefined): boolean {
	return kind === undefined
		? EVERY_EVENT.every(every => offeredTo.includes(every))
		: offeredTo.includes(kind);
}

/** The items offered to an Event of `kind` (`isOfferedToEvent`), their declarations dropped. */
export function itemsOfferedToEvent<T extends { offeredTo: readonly EventKind[] }>(items: readonly T[], kind: EventKind | undefined): Omit<T, 'offeredTo'>[] {
	return items
		.filter(item => isOfferedToEvent(item.offeredTo, kind))
		.map(({ offeredTo: _offeredTo, ...item }) => item);
}

/** Whether an Event may hold Broadcast Deck Lists: a Two-Player Magic: The Gathering Event only (ADR-0087). */
export function holdsBroadcastDeckLists(event: { game: Game; variant?: Variant | null }): boolean {
	return isOfferedToEvent(TWO_PLAYER_MAGIC_ONLY, eventKind(event));
}

export function getGameConfig(game: Game): GameConfig {
	return GAME_CONFIGS[game];
}

/**
 * A Commander Event's Match Format defaults: one game at 40 life, untimed, with
 * no extra turns (ADR-0087). Everything else is Magic: The Gathering's.
 */
const COMMANDER_EVENT_DEFAULTS: FeatureMatchDefaults = {
	...GAME_CONFIGS.mtg.defaults,
	bestOf: 1,
	startingLife: 40,
	clockType: 'untimed',
	extraTurnsEnabled: false,
};

/** The Match Format a new Event of `kind` starts with: its Card Game's, or a Commander Event's own. */
export function getMatchFormatDefaults(kind: EventKind): FeatureMatchDefaults {
	return {
		...(kind === 'mtg-commander'
			? COMMANDER_EVENT_DEFAULTS
			: GAME_CONFIGS[EVENT_KIND_CARD_GAME[kind]]?.defaults ?? DEFAULT_FEATURE_MATCH_DEFAULTS),
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

/** What a Commander Event tracks: Magic: The Gathering's, without extra turns or a Sideboard to reveal (ADR-0087). */
const COMMANDER_EVENT_TRACKS: FeatureMatchStateTracking = {
	...GAME_CONFIGS.mtg.tracks,
	overtime: false,
	sideboard: false,
};

/** The parts of Feature Match state an Event of `kind` tracks: its Card Game's, or a Commander Event's own; none of the optional ones for a game with no config. */
export function getFeatureMatchStateTracking(kind: EventKind): FeatureMatchStateTracking {
	return kind === 'mtg-commander'
		? COMMANDER_EVENT_TRACKS
		: GAME_CONFIGS[EVENT_KIND_CARD_GAME[kind]]?.tracks ?? TRACKS_NOTHING_OPTIONAL;
}

export function getPlayerIdentityLabel(game: Game): string {
	return GAME_CONFIGS[game]?.playerIdentityLabel ?? 'Deck';
}

/** What a Metagame of `game` reads; participation only for a game with no config. */
export function getMetagameRules(game: Game): MetagameRules {
	return GAME_CONFIGS[game]?.metagame ?? PARTICIPATION_ONLY;
}
