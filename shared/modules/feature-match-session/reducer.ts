import type { PlayerSide, Seat } from '~~/shared/types/enums';
import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { CommanderNumber, CounterState, FeatureMatchOutcome, FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchClock } from './clock';
import { getStartingTurnNumber } from '~~/shared/config/games';
import { SEAT_VALUES } from '~~/shared/types/enums';
import {
	COMMANDER_NUMBER_VALUES,
	createInitialFeatureMatchState,
	createInitialOvertimeState,
	createInitialSeatState,
	DEFAULT_CLOCK_DURATION_MS,
	DEFAULT_CLOCK_TYPE,
	DEFAULT_STARTING_LIFE,
	resetPlayerFeatureMatchStateForNewGame,
} from '~~/shared/types/featureMatchState';
import { clockTransitions, minutesToMs, readStoredClock, writeStoredClock } from './clock';
import {
	applyCommanderDamage,
	applyCommanderTurnStep,
	commanderStartingLife,
	isCommanderSession,
	isSeatFilled,
	withSeatsCorrected,
	withSeatsSwapped,
} from './commander';
import { applyFeatureMatchOvertimeStep, applyFeatureMatchTurnStep, otherFeatureMatchPlayer, pairSeatOf } from './turns';

export interface FeatureMatchSessionReducerResult {
	currentState: FeatureMatchState;
	sourceSnapshot: FeatureMatchSourceSnapshot;
}

export type FeatureMatchSessionEventPayload = Record<string, unknown>;

export function createInitialFeatureMatchSessionStateFromSnapshot(snapshot: FeatureMatchSourceSnapshot): FeatureMatchState {
	const durationMs = snapshot.defaults.clockDuration != null
		? minutesToMs(snapshot.defaults.clockDuration)
		: DEFAULT_CLOCK_DURATION_MS;

	const initial = createInitialFeatureMatchState(
		snapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE,
		snapshot.defaults.clockType ?? DEFAULT_CLOCK_TYPE,
		durationMs,
		snapshot.defaults.countUpAfterCountdown ?? false,
		getStartingTurnNumber(snapshot.game),
		snapshot.defaults.countUpLimit != null
			? minutesToMs(snapshot.defaults.countUpLimit)
			: null,
	);
	return isCommanderSession(snapshot)
		? {
				...initial,
				...commanderSeatStates(snapshot),
			}
		: initial;
}

/** Every Seat of a Commander game as it starts: at the Event's starting life (ADR-0087). */
function commanderSeatStates(snapshot: FeatureMatchSourceSnapshot): Required<Pick<FeatureMatchState, Seat>> {
	const startingLife = commanderStartingLife(snapshot);
	return {
		player1: createInitialSeatState(startingLife),
		player2: createInitialSeatState(startingLife),
		player3: createInitialSeatState(startingLife),
		player4: createInitialSeatState(startingLife),
	};
}

interface FeatureMatchBatchedEvent {
	type: FeatureMatchCommandType;
	payload: FeatureMatchSessionEventPayload;
}

/** The batch's command list, or null when its shape is malformed. */
function batchedEvents(payload: FeatureMatchSessionEventPayload): FeatureMatchBatchedEvent[] | null {
	if (!Array.isArray(payload.commands))
		return null;
	const events: FeatureMatchBatchedEvent[] = [];
	for (const command of payload.commands) {
		if (typeof command !== 'object' || command === null)
			return null;
		const { type, payload: commandPayload } = command as Record<string, unknown>;
		if (commandPayload != null && typeof commandPayload !== 'object')
			return null;
		events.push({
			type: type as FeatureMatchCommandType,
			payload: (commandPayload ?? {}) as FeatureMatchSessionEventPayload,
		});
	}
	return events;
}

// ─── Payload boundary guards ────────────────────────────────────────────────
// Payloads reach the reducer from the persisted event log as well as from
// clients, and both replay: a non-finite number committed once survives every
// later event (Math.max(0, NaN) is NaN). An action whose payload fails a guard
// is rejected wholesale — state is returned unchanged — so no shape of payload
// can commit a non-finite number. Rejection is distinct from a semantic no-op
// (pausing an already-paused clock): inside a Batch, a rejection sinks the
// whole batch, because a Batch Command's save lands whole or not at all.

/** Coerce like `Number(...)` but refuse to hand back a non-finite result. */
function finiteNumber(value: unknown): number | null {
	const coerced = Number(value);
	return Number.isFinite(coerced)
		? coerced
		: null;
}

function playerSideOf(value: unknown): PlayerSide | null {
	return value === 'player1' || value === 'player2'
		? value
		: null;
}

/**
 * The Seat a command names, where the Session has it in its game: one of the
 * pair on every Session but a Commander Session, whose four Seats are each in
 * the game only while filled (ADR-0087).
 */
function seatOf(value: unknown, sourceSnapshot: FeatureMatchSourceSnapshot): Seat | null {
	if (!isCommanderSession(sourceSnapshot))
		return playerSideOf(value);
	const seat = SEAT_VALUES.find(candidate => candidate === value);
	return seat && isSeatFilled(sourceSnapshot, seat)
		? seat
		: null;
}

function commanderNumberOf(value: unknown): CommanderNumber | null {
	return COMMANDER_NUMBER_VALUES.find(candidate => candidate === value) ?? null;
}

/** A declared outcome: a winning Seat in the game, or `{ winner: null }` for a draw. */
function outcomeOf(value: unknown, sourceSnapshot: FeatureMatchSourceSnapshot): FeatureMatchOutcome | null {
	if (typeof value !== 'object' || value === null)
		return null;
	const { winner } = value as { winner?: unknown };
	if (winner === null)
		return { winner: null };
	const seat = seatOf(winner, sourceSnapshot);
	return seat && { winner: seat };
}

function countersOf(value: unknown): CounterState[] | null {
	if (!Array.isArray(value))
		return null;
	const counters: CounterState[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null)
			return null;
		const { type, value: counterValue } = entry as { type?: unknown; value?: unknown };
		if (typeof type !== 'string' || typeof counterValue !== 'number' || !Number.isFinite(counterValue))
			return null;
		counters.push({ type, value: counterValue });
	}
	return counters;
}

export function normalizeFeatureMatchSessionCommandPayload(
	type: FeatureMatchCommandType,
	payload: FeatureMatchSessionEventPayload,
	now: () => number = Date.now,
): FeatureMatchSessionEventPayload {
	if (type === 'Batch') {
		const commands = batchedEvents(payload);
		// A malformed batch shape is left untouched for the reducer to reject.
		if (commands === null)
			return payload;
		return {
			...payload,
			commands: commands.map(command => ({
				...command,
				payload: normalizeFeatureMatchSessionCommandPayload(command.type, command.payload, now),
			})),
		};
	}

	if (
		type === 'AdjustClock'
		|| type === 'SetClock'
		|| type === 'StartClock'
		|| type === 'PauseClock'
		|| type === 'RestartClock'
	) {
		return {
			...payload,
			at: now(),
		};
	}

	return payload;
}

/**
 * A snapshot rebuilt from the Slot, with the facts that belong to the Session put back.
 *
 * A `SnapshotCorrected` payload always comes from `buildSourceSnapshot`, which reads
 * the Slot row: it carries the Slot's facts, and everything a Session knows about
 * itself is absent or freshly invented. Two such facts exist, and both are restored
 * here rather than at the two call sites that raise a correction — `featureMatch`'s
 * update and `playerFeatureMatchSync`'s reverse sync — because a third cannot then
 * forget one.
 *
 * **Orientation.** `buildSourceSnapshot` knows nothing about `SwapPlayers`, so a
 * rebuild arrives in Slot order every time. Which side a player sits on belongs to the
 * Session, so the correction carries the Slot's facts and the Session keeps its sides.
 *
 * **Creation time.** `createdAt` is stamped `Date.now()` on every build, so a rebuild
 * arrives claiming the Session's snapshot was first taken at the moment of the
 * correction. It means *first taken*, and a correction is not a taking: it revises a
 * snapshot the Session has been holding since it opened. Before #332 every correction
 * moved it, including the ones raised by a reverse sync where nothing about the Slot
 * had changed. The questions that *are* about a moving time are the Session row's own:
 * its `createdAt` and `updatedAt` columns say when the Session opened and when it last
 * advanced, and neither of those is what this field is for.
 */
function correctedSourceSnapshot(
	rebuilt: FeatureMatchSourceSnapshot,
	held: FeatureMatchSourceSnapshot,
): FeatureMatchSourceSnapshot {
	const oriented = (held.playersSwapped ?? false)
		? {
				...rebuilt,
				player1: rebuilt.player2,
				player2: rebuilt.player1,
				playersSwapped: true,
			}
		: rebuilt;

	return { ...oriented, createdAt: held.createdAt };
}

/** Whether the match is decided, re-asked of the game wins it holds under a new best of. */
function withMatchDecidedFor(currentState: FeatureMatchState, bestOf: number): FeatureMatchState {
	const winsNeeded = Math.ceil(bestOf / 2);
	const isComplete = Math.max(currentState.player1.gameWins, currentState.player2.gameWins) >= winsNeeded;
	return isComplete === currentState.isComplete
		? currentState
		: { ...currentState, isComplete };
}

const UNTIMED_REFUSED_COMMANDS = new Set<string>([
	'AdjustClock',
	'SetClock',
	'StartClock',
	'RestartClock',
	'StartOvertime',
]);

/** What a Commander Session's one game has none of: game wins, extra turns, a Sideboard reveal, a Session-only swap (ADR-0087). */
const COMMANDER_REFUSED_COMMANDS = new Set<string>([
	'RecordGameWin',
	'UndoGameWin',
	'StartOvertime',
	'StepOvertime',
	'SetSideboardRevealed',
	'SwapPlayers',
]);

/** What only a Commander Session takes. */
const COMMANDER_ONLY_COMMANDS = new Set<string>([
	'AdjustCommanderDamage',
	'SetEliminated',
	'SetOutcome',
]);

/** Seats 3 and 4, which only a Commander Slot has. */
const COMMANDER_ONLY_SEATS: readonly unknown[] = SEAT_VALUES.filter(seat => playerSideOf(seat) === null);

/**
 * Whether an operator's command is one a Session of this Variant never takes
 * (ADR-0087): a Commander Session plays one game, and only a Commander Session
 * has Seats 3 and 4, Commander Damage, Eliminated Seats and a declared outcome.
 * The reducer rejects such a command, and the API refuses it by this.
 */
export function isCommandOutsideSessionVariant(
	sourceSnapshot: FeatureMatchSourceSnapshot,
	type: FeatureMatchCommandType,
	payload: FeatureMatchSessionEventPayload,
): boolean {
	if (type === 'Batch') {
		return (batchedEvents(payload) ?? [])
			.some(command => isCommandOutsideSessionVariant(sourceSnapshot, command.type, command.payload));
	}
	if (isCommanderSession(sourceSnapshot))
		return COMMANDER_REFUSED_COMMANDS.has(type);
	return COMMANDER_ONLY_COMMANDS.has(type)
		|| COMMANDER_ONLY_SEATS.includes(payload.player);
}

/** An untimed match refuses what would run, set or adjust its clock, and extra turns. */
function isRefusedByUntimedMatch(currentState: FeatureMatchState, type: string): boolean {
	return currentState.clock.type === 'untimed' && UNTIMED_REFUSED_COMMANDS.has(type);
}

const CLOCK_COMMAND_TYPES = [
	'AdjustClock',
	'SetClock',
	'StartClock',
	'PauseClock',
	'ResetClock',
	'RestartClock',
] as const satisfies readonly FeatureMatchCommandType[];

export type FeatureMatchClockCommandType = typeof CLOCK_COMMAND_TYPES[number];

function isClockCommand(type: string): type is FeatureMatchClockCommandType {
	return (CLOCK_COMMAND_TYPES as readonly string[]).includes(type);
}

/**
 * A clock command's reduction, which needs only the Session's state: the
 * instant and amounts its payload must carry, then the shared clock
 * transition, on the stored clock as the app holds it and stored again in the
 * stored shape. A reset also clears extra turns. `null` rejects the command.
 */
function reduceClockCommand(
	currentState: FeatureMatchState,
	type: FeatureMatchClockCommandType,
	payload: FeatureMatchSessionEventPayload,
): FeatureMatchState | null {
	const current = readStoredClock(currentState.clock);
	if (type === 'ResetClock') {
		const durationMs = payload.durationMs == null
			? undefined
			: finiteNumber(payload.durationMs);
		if (durationMs === null)
			return null;
		return {
			...currentState,
			clock: writeStoredClock(clockTransitions.reset(current, durationMs)),
			overtime: undefined,
		};
	}

	const at = finiteNumber(payload.at);
	if (at === null)
		return null;

	let clock: FeatureMatchClock;
	if (type === 'AdjustClock') {
		const deltaMs = finiteNumber(payload.deltaMs ?? 0);
		if (deltaMs === null)
			return null;
		clock = clockTransitions.adjust(current, at, deltaMs);
	}
	else if (type === 'SetClock') {
		const targetMs = finiteNumber(payload.targetMs ?? 0);
		if (targetMs === null)
			return null;
		clock = clockTransitions.set(current, at, targetMs);
	}
	else if (type === 'StartClock') {
		clock = clockTransitions.start(current, at);
	}
	else if (type === 'PauseClock') {
		clock = clockTransitions.pause(current, at);
	}
	else {
		clock = clockTransitions.restart(current, at);
	}

	// A transition that changes nothing leaves the Session's state as it was.
	return clock === current
		? currentState
		: {
				...currentState,
				clock: writeStoredClock(clock),
			};
}

/**
 * What the reducer answers a clock command at `at` (server time), for an
 * operator's optimistic update to show while the command is out: the same
 * Session rules and the same transition, so the answer changes nothing shown.
 * A command the Session refuses leaves the state as it was.
 */
export function applyFeatureMatchClockCommand(
	currentState: FeatureMatchState,
	type: FeatureMatchClockCommandType,
	payload: { at?: number; deltaMs?: number; targetMs?: number; durationMs?: number },
): FeatureMatchState {
	if (isRefusedByUntimedMatch(currentState, type))
		return currentState;
	return reduceClockCommand(currentState, type, payload) ?? currentState;
}

export function applyFeatureMatchSessionEvent(
	currentState: FeatureMatchState,
	sourceSnapshot: FeatureMatchSourceSnapshot,
	type: FeatureMatchCommandType | 'SessionStarted' | 'SnapshotCorrected',
	payload: FeatureMatchSessionEventPayload,
): FeatureMatchSessionReducerResult {
	return reduceFeatureMatchSessionEvent(currentState, sourceSnapshot, type, payload)
		?? { currentState, sourceSnapshot };
}

/**
 * The reducer proper. `null` means the event failed a payload boundary guard
 * and was rejected; the public wrapper turns that into "state unchanged", while
 * the Batch case uses it to sink the whole batch.
 */
function reduceFeatureMatchSessionEvent(
	currentState: FeatureMatchState,
	sourceSnapshot: FeatureMatchSourceSnapshot,
	type: FeatureMatchCommandType | 'SessionStarted' | 'SnapshotCorrected',
	payload: FeatureMatchSessionEventPayload,
): FeatureMatchSessionReducerResult | null {
	if (type === 'SessionStarted') {
		return {
			currentState: payload.currentState as FeatureMatchState,
			sourceSnapshot: payload.sourceSnapshot as FeatureMatchSourceSnapshot,
		};
	}

	if (type === 'SnapshotCorrected') {
		const corrected = correctedSourceSnapshot(
			payload.sourceSnapshot as FeatureMatchSourceSnapshot,
			sourceSnapshot,
		);
		// A Commander game is decided by its declared outcome, never by game wins.
		if (isCommanderSession(corrected)) {
			return {
				currentState: withSeatsCorrected(currentState, sourceSnapshot, corrected),
				sourceSnapshot: corrected,
			};
		}
		return {
			currentState: corrected.bestOf === sourceSnapshot.bestOf
				? currentState
				: withMatchDecidedFor(currentState, corrected.bestOf),
			sourceSnapshot: corrected,
		};
	}

	// An untimed match has no clock to run and so no time to run out: nothing
	// starts, sets or adjusts its clock, and no extra turns begin.
	if (isRefusedByUntimedMatch(currentState, type))
		return null;

	const isCommander = isCommanderSession(sourceSnapshot);
	if (type !== 'Batch' && isCommandOutsideSessionVariant(sourceSnapshot, type, payload))
		return null;

	// One event, many field writes: an operator's multi-field save folds through
	// the same reducer cases it would have hit as serial commands, but commits as
	// a single all-or-nothing reduction — a malformed shape or a rejected
	// sub-command sinks the whole batch.
	if (type === 'Batch') {
		const commands = batchedEvents(payload);
		if (commands === null)
			return null;
		let result: FeatureMatchSessionReducerResult = { currentState, sourceSnapshot };
		for (const command of commands) {
			const next = reduceFeatureMatchSessionEvent(result.currentState, result.sourceSnapshot, command.type, command.payload);
			if (next === null)
				return null;
			result = next;
		}
		return result;
	}

	if (type === 'AdjustLife') {
		const player = seatOf(payload.player, sourceSnapshot);
		const seatState = player && currentState[player];
		const delta = finiteNumber(payload.delta ?? 0);
		if (!player || !seatState || delta === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...seatState,
					lifeTotal: seatState.lifeTotal + delta,
				},
			},
		};
	}

	if (type === 'SetLife') {
		const player = seatOf(payload.player, sourceSnapshot);
		const seatState = player && currentState[player];
		const lifeTotal = finiteNumber(payload.lifeTotal);
		if (!player || !seatState || lifeTotal === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...seatState,
					lifeTotal,
				},
			},
		};
	}

	if (type === 'SetCounters') {
		const player = seatOf(payload.player, sourceSnapshot);
		const seatState = player && currentState[player];
		const counters = countersOf(payload.counters);
		if (!player || !seatState || counters === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...seatState,
					counters,
				},
			},
		};
	}

	if (type === 'SetCardsKept') {
		const player = seatOf(payload.player, sourceSnapshot);
		const seatState = player && currentState[player];
		const cardsKept = finiteNumber(payload.cardsKept);
		if (!player || !seatState || cardsKept === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...seatState,
					cardsKept,
				},
			},
		};
	}

	if (type === 'AdjustCommanderDamage') {
		const player = seatOf(payload.player, sourceSnapshot);
		const from = seatOf(payload.from, sourceSnapshot);
		const commanderNumber = commanderNumberOf(payload.commander);
		const delta = finiteNumber(payload.delta);
		if (!player || !from || commanderNumber === null || delta === null)
			return null;
		const damaged = applyCommanderDamage(currentState, sourceSnapshot, player, { seat: from, commander: commanderNumber }, delta);
		return damaged && { sourceSnapshot, currentState: damaged };
	}

	if (type === 'SetEliminated') {
		const player = seatOf(payload.player, sourceSnapshot);
		const seatState = player && currentState[player];
		const eliminated = payload.eliminated;
		if (!player || !seatState || typeof eliminated !== 'boolean')
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: { ...seatState, eliminated },
			},
		};
	}

	if (type === 'SetOutcome') {
		// Taking the outcome back reopens the game.
		if (payload.outcome === null) {
			const { outcome: _outcome, ...reopened } = currentState;
			return {
				sourceSnapshot,
				currentState: { ...reopened, isComplete: false },
			};
		}
		const outcome = outcomeOf(payload.outcome, sourceSnapshot);
		if (!outcome)
			return null;
		return {
			sourceSnapshot,
			currentState: { ...currentState, outcome, isComplete: true },
		};
	}

	if (type === 'SwapSeats') {
		const seats = Array.isArray(payload.seats)
			? payload.seats
			: [];
		const first = SEAT_VALUES.find(seat => seat === seats[0]);
		const second = SEAT_VALUES.find(seat => seat === seats[1]);
		const swapped = payload.sourceSnapshot as FeatureMatchSourceSnapshot | null | undefined;
		if (!first || !second || first === second || !swapped || !isCommanderSession(swapped))
			return null;
		// The Slot has exchanged the two Seats already, so its snapshot is taken as
		// it is: neither Seat joins or leaves, each player keeps what they held. A
		// Session opened before a Commander Slot had four Seats gains the missing two.
		return {
			currentState: withSeatsSwapped({
				...commanderSeatStates(swapped),
				...currentState,
			}, first, second),
			sourceSnapshot: correctedSourceSnapshot(swapped, sourceSnapshot),
		};
	}

	if (type === 'SetSideboardRevealed') {
		const player = playerSideOf(payload.player);
		const revealed = payload.revealed;
		if (!player || typeof revealed !== 'boolean')
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					sideboardRevealed: revealed,
				},
			},
		};
	}

	if (isClockCommand(type)) {
		const reduced = reduceClockCommand(currentState, type, payload);
		return reduced && { currentState: reduced, sourceSnapshot };
	}

	if (type === 'SelectFirstPlayer') {
		const player = seatOf(payload.player, sourceSnapshot);
		if (!player)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				firstPlayer: player,
				activePlayer: player,
				turnNumber: 1,
			},
		};
	}

	if (type === 'SetFirstPlayer') {
		const player = seatOf(payload.player, sourceSnapshot);
		if (!player)
			return null;
		return {
			sourceSnapshot,
			currentState: { ...currentState, firstPlayer: player },
		};
	}

	if (type === 'SetActivePlayer') {
		const player = seatOf(payload.player, sourceSnapshot);
		if (!player && payload.player != null)
			return null;
		return {
			sourceSnapshot,
			currentState: { ...currentState, activePlayer: player },
		};
	}

	if (type === 'SetTurnNumber') {
		const turnNumber = finiteNumber(payload.turnNumber);
		if (turnNumber === null)
			return null;
		return {
			sourceSnapshot,
			currentState: { ...currentState, turnNumber },
		};
	}

	if (type === 'RecordGameWin') {
		const player = playerSideOf(payload.player);
		const startingLife = finiteNumber(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);
		if (!player || startingLife === null)
			return null;
		// A decided match takes no further wins; undoing the deciding one reopens it.
		if (currentState.isComplete)
			return { currentState, sourceSnapshot };
		const opponent = otherFeatureMatchPlayer(player);
		const resetLife = payload.resetLife !== false;
		const resetCounters = payload.resetCounters !== false;
		const winner = currentState[player];
		const wins = winner.gameWins + 1;
		const winsNeeded = Math.ceil(sourceSnapshot.bestOf / 2);

		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...winner,
					gameWins: wins,
					lifeTotal: resetLife ? startingLife : winner.lifeTotal,
					counters: resetCounters
						? []
						: winner.counters,
					cardsKept: resetLife ? undefined : winner.cardsKept,
				},
				[opponent]: {
					...currentState[opponent],
					lifeTotal: resetLife ? startingLife : currentState[opponent].lifeTotal,
					counters: resetCounters
						? []
						: currentState[opponent].counters,
					cardsKept: resetLife ? undefined : currentState[opponent].cardsKept,
				},
				currentGame: currentState.currentGame + 1,
				turnNumber: getStartingTurnNumber(sourceSnapshot.game),
				isComplete: wins >= winsNeeded,
				activePlayer: null,
				firstPlayer: null,
			},
		};
	}

	if (type === 'UndoGameWin') {
		const player = playerSideOf(payload.player);
		const startingLife = finiteNumber(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);
		if (!player || startingLife === null)
			return null;
		if (currentState[player].gameWins <= 0)
			return { currentState, sourceSnapshot };
		const opponent = otherFeatureMatchPlayer(player);
		const resetLife = payload.resetLife === true;
		const resetCounters = payload.resetCounters === true;
		const winsNeeded = Math.ceil(sourceSnapshot.bestOf / 2);
		const stillDecided = Math.max(currentState[player].gameWins - 1, currentState[opponent].gameWins) >= winsNeeded;

		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					gameWins: currentState[player].gameWins - 1,
					lifeTotal: resetLife ? startingLife : currentState[player].lifeTotal,
					counters: resetCounters
						? []
						: currentState[player].counters,
				},
				[opponent]: {
					...currentState[opponent],
					lifeTotal: resetLife ? startingLife : currentState[opponent].lifeTotal,
					counters: resetCounters
						? []
						: currentState[opponent].counters,
				},
				currentGame: Math.max(1, currentState.currentGame - 1),
				isComplete: stillDecided,
			},
		};
	}

	if (type === 'ResetState') {
		const startingLife = finiteNumber(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);
		if (startingLife === null)
			return null;
		// A Commander Session's game is its whole Session, so either reset starts
		// a new one with the same players (ADR-0087).
		if (payload.type === 'match' || isCommander) {
			return {
				sourceSnapshot,
				currentState: createInitialFeatureMatchSessionStateFromSnapshot(sourceSnapshot),
			};
		}

		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				player1: resetPlayerFeatureMatchStateForNewGame(currentState.player1, startingLife, true),
				player2: resetPlayerFeatureMatchStateForNewGame(currentState.player2, startingLife, true),
				turnNumber: getStartingTurnNumber(sourceSnapshot.game),
				activePlayer: null,
				firstPlayer: null,
			},
		};
	}

	if (type === 'StartOvertime') {
		const totalTurns = finiteNumber(payload.totalTurns);
		if (totalTurns === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				overtime: createInitialOvertimeState(totalTurns),
			},
		};
	}

	if (type === 'StepTurn') {
		const delta = finiteNumber(payload.delta ?? 0);
		if (delta === null)
			return null;
		return {
			sourceSnapshot,
			currentState: isCommander
				? applyCommanderTurnStep(currentState, sourceSnapshot, delta)
				: applyFeatureMatchTurnStep(currentState, delta),
		};
	}

	if (type === 'StepOvertime') {
		const delta = finiteNumber(payload.delta ?? 0);
		if (delta === null)
			return null;
		return {
			sourceSnapshot,
			currentState: applyFeatureMatchOvertimeStep(currentState, delta),
		};
	}

	if (type === 'SwapPlayers') {
		const activePlayer = pairSeatOf(currentState.activePlayer);
		const firstPlayer = pairSeatOf(currentState.firstPlayer);
		const swappedActivePlayer = activePlayer
			? otherFeatureMatchPlayer(activePlayer)
			: currentState.activePlayer;
		const swappedFirstPlayer = firstPlayer
			? otherFeatureMatchPlayer(firstPlayer)
			: currentState.firstPlayer;
		return {
			sourceSnapshot: {
				...sourceSnapshot,
				player1: sourceSnapshot.player2,
				player2: sourceSnapshot.player1,
				// Recorded so a later correction rebuilt from the Slot can be put back
				// into the sides the operator chose. Nothing on the Slot row is
				// swap-aware, so this flag is the only place the choice survives.
				playersSwapped: !(sourceSnapshot.playersSwapped ?? false),
			},
			currentState: {
				...currentState,
				player1: currentState.player2,
				player2: currentState.player1,
				activePlayer: swappedActivePlayer,
				firstPlayer: swappedFirstPlayer,
			},
		};
	}

	return { currentState, sourceSnapshot };
}
