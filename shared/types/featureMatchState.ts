import type { ClockType, PlayerSide } from './enums';

// Counter state
export interface CounterState {
	type: string; // Can be predefined or custom
	value: number;
}

// Player feature match state
export interface PlayerFeatureMatchState {
	lifeTotal: number;
	gameWins: number;
	counters: CounterState[];
	cardsKept?: number;
	/**
	 * Whether this player's sideboard is revealed on the live overlay. Match-scoped:
	 * a game reset or game win must not touch it; only a match reset re-hides (#490).
	 * Optional for the same reason `cardsKept` is: absent on states persisted
	 * before the flag existed, which every reader treats as hidden.
	 */
	sideboardRevealed?: boolean;
}

// Clock state
export interface ClockState {
	type: ClockType;
	durationMs: number;
	elapsedMs: number;
	isRunning: boolean;
	lastStartedAt: number | null; // Server timestamp when clock was last started
	countUpAfterCountdown: boolean; // When countdown expires, continue counting up to show overtime elapsed
}

// Overtime state (e.g., MTG extra turns)
export interface OvertimeState {
	active: boolean;
	turnsRemaining: number;
	totalTurns: number;
}

// Complete feature match state
export interface FeatureMatchState {
	player1: PlayerFeatureMatchState;
	player2: PlayerFeatureMatchState;
	clock: ClockState;
	currentGame: number;
	turnNumber: number;
	isComplete: boolean;
	activePlayer?: PlayerSide | null;
	firstPlayer?: PlayerSide | null;
	overtime?: OvertimeState;
}

// Default values
export const DEFAULT_STARTING_LIFE = 20;
export const DEFAULT_CLOCK_DURATION_MS = 50 * 60 * 1000; // 50 minutes in ms
export const DEFAULT_CLOCK_TYPE: ClockType = 'countdown';

// Helper to create initial player feature match state
export function createInitialPlayerFeatureMatchState(startingLife: number = DEFAULT_STARTING_LIFE): PlayerFeatureMatchState {
	return {
		lifeTotal: startingLife,
		gameWins: 0,
		counters: [],
		sideboardRevealed: false,
	};
}

// Helper to create initial clock state
export function createInitialClockState(
	type: ClockType = DEFAULT_CLOCK_TYPE,
	durationMs: number = DEFAULT_CLOCK_DURATION_MS,
	countUpAfterCountdown: boolean = false,
): ClockState {
	return {
		type,
		durationMs,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown,
	};
}

// Helper to create initial feature match state
export function createInitialFeatureMatchState(
	startingLife: number = DEFAULT_STARTING_LIFE,
	clockType: ClockType = DEFAULT_CLOCK_TYPE,
	clockDurationMs: number = DEFAULT_CLOCK_DURATION_MS,
	countUpAfterCountdown: boolean = false,
	startingTurnNumber: number = 0,
): FeatureMatchState {
	return {
		player1: createInitialPlayerFeatureMatchState(startingLife),
		player2: createInitialPlayerFeatureMatchState(startingLife),
		clock: createInitialClockState(clockType, clockDurationMs, countUpAfterCountdown),
		currentGame: 1,
		turnNumber: startingTurnNumber,
		isComplete: false,
		activePlayer: null,
		firstPlayer: null,
	};
}

// Helper to create initial overtime state
export function createInitialOvertimeState(totalTurns: number): OvertimeState {
	return {
		active: true,
		turnsRemaining: totalTurns,
		totalTurns,
	};
}

// ─── API Input Types ─────────────────────────────────────────────────────────
// Shared between app (repository) and server (service) so the contract stays
// in one place.

export interface PlayerFeatureMatchStateUpdate {
	lifeTotal?: number;
	lifeDelta?: number;
	counters?: { type: string; value: number }[];
	cardsKept?: number;
	sideboardRevealed?: boolean;
}

export interface GameWinOptions {
	resetLife?: boolean;
	resetCounters?: boolean;
	startingLife?: number;
}

// Helper to reset player feature match state for new game (keeps wins)
export function resetPlayerFeatureMatchStateForNewGame(
	player: PlayerFeatureMatchState,
	startingLife: number = DEFAULT_STARTING_LIFE,
	resetCounters: boolean = true,
): PlayerFeatureMatchState {
	return {
		...player,
		lifeTotal: startingLife,
		counters: resetCounters ? [] : player.counters,
		cardsKept: undefined,
	};
}
