import type { ClockType, Seat } from './enums';

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
	/**
	 * The Commander Damage this Seat has taken, a count per opposing Commander
	 * (ADR-0087). A Commander Session's alone; a Commander that has dealt none
	 * has no entry.
	 */
	commanderDamage?: CommanderDamageState[];
	/** Whether this Seat is Eliminated, which only its operator sets (ADR-0087). A Commander Session's alone. */
	eliminated?: boolean;
}

/** Which of a Seat's Commanders: its first or, for a pair, its second. */
export const COMMANDER_NUMBER_VALUES = [1, 2] as const;
export type CommanderNumber = typeof COMMANDER_NUMBER_VALUES[number];

/** One Commander at the table: the Seat holding it, and which of that Seat's Commanders it is. */
export interface CommanderSource {
	seat: Seat;
	commander: CommanderNumber;
}

/** The Commander Damage one Seat has taken from one opposing Commander. */
export interface CommanderDamageState extends CommanderSource {
	damage: number;
}

/** How a Commander game ended: its winning Seat, or `null` for a draw (ADR-0087). */
export interface FeatureMatchOutcome {
	winner: Seat | null;
}

// Clock state
export interface ClockState {
	type: ClockType;
	durationMs: number;
	elapsedMs: number;
	isRunning: boolean;
	lastStartedAt: number | null; // Server timestamp when clock was last started
	countUpAfterCountdown: boolean; // When countdown expires, continue counting up to show overtime elapsed
	/**
	 * How far a countdown counts up after it expires before holding; `null`
	 * counts up without limit. Optional because states persisted before the
	 * limit existed carry none, which every reader treats as no limit.
	 */
	countUpLimitMs?: number | null;
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
	/** Seats 3 and 4, which only a Commander Session holds (ADR-0087). */
	player3?: PlayerFeatureMatchState;
	player4?: PlayerFeatureMatchState;
	clock: ClockState;
	currentGame: number;
	turnNumber: number;
	isComplete: boolean;
	/** One of the pair on every Session but a Commander Session, where any Seat takes the turn. */
	activePlayer?: Seat | null;
	firstPlayer?: Seat | null;
	overtime?: OvertimeState;
	/** A Commander Session's declared outcome, which completes it; absent while its game is on. */
	outcome?: FeatureMatchOutcome;
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

/** A Seat's state as a Commander game starts: at starting life, undamaged and in the game (ADR-0087). */
export function createInitialSeatState(startingLife: number): PlayerFeatureMatchState {
	return {
		...createInitialPlayerFeatureMatchState(startingLife),
		commanderDamage: [],
		eliminated: false,
	};
}

// Helper to create initial clock state
export function createInitialClockState(
	type: ClockType = DEFAULT_CLOCK_TYPE,
	durationMs: number = DEFAULT_CLOCK_DURATION_MS,
	countUpAfterCountdown: boolean = false,
	countUpLimitMs: number | null = null,
): ClockState {
	return {
		type,
		durationMs,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown,
		countUpLimitMs,
	};
}

// Helper to create initial feature match state
export function createInitialFeatureMatchState(
	startingLife: number = DEFAULT_STARTING_LIFE,
	clockType: ClockType = DEFAULT_CLOCK_TYPE,
	clockDurationMs: number = DEFAULT_CLOCK_DURATION_MS,
	countUpAfterCountdown: boolean = false,
	startingTurnNumber: number = 0,
	countUpLimitMs: number | null = null,
): FeatureMatchState {
	return {
		player1: createInitialPlayerFeatureMatchState(startingLife),
		player2: createInitialPlayerFeatureMatchState(startingLife),
		clock: createInitialClockState(clockType, clockDurationMs, countUpAfterCountdown, countUpLimitMs),
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
		counters: resetCounters
			? []
			: player.counters,
		cardsKept: undefined,
	};
}
