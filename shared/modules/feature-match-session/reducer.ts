import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { CounterState, FeatureMatchState } from '~~/shared/types/featureMatchState';
import { getStartingTurnNumber } from '~~/shared/config/games';
import {
	createInitialFeatureMatchState,
	createInitialOvertimeState,
	DEFAULT_CLOCK_DURATION_MS,
	DEFAULT_CLOCK_TYPE,
	DEFAULT_STARTING_LIFE,
	resetPlayerFeatureMatchStateForNewGame,
} from '~~/shared/types/featureMatchState';
import { applyClockAdjustment } from './clock';
import { applyFeatureMatchOvertimeStep, applyFeatureMatchTurnStep, otherFeatureMatchPlayer } from './turns';

export interface FeatureMatchSessionReducerResult {
	currentState: FeatureMatchState;
	sourceSnapshot: FeatureMatchSourceSnapshot;
}

export type FeatureMatchSessionEventPayload = Record<string, unknown>;

export function createInitialFeatureMatchSessionStateFromSnapshot(snapshot: FeatureMatchSourceSnapshot): FeatureMatchState {
	const durationMs = snapshot.defaults.clockDuration != null
		? snapshot.defaults.clockDuration * 60 * 1000
		: DEFAULT_CLOCK_DURATION_MS;

	return createInitialFeatureMatchState(
		snapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE,
		snapshot.defaults.clockType ?? DEFAULT_CLOCK_TYPE,
		durationMs,
		snapshot.defaults.countUpAfterCountdown ?? false,
		getStartingTurnNumber(snapshot.game),
	);
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
	return Number.isFinite(coerced) ? coerced : null;
}

function playerSideOf(value: unknown): PlayerSide | null {
	return value === 'player1' || value === 'player2' ? value : null;
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
		return { ...payload, at: now() };
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
		return {
			currentState,
			sourceSnapshot: correctedSourceSnapshot(
				payload.sourceSnapshot as FeatureMatchSourceSnapshot,
				sourceSnapshot,
			),
		};
	}

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
		const player = playerSideOf(payload.player);
		const delta = finiteNumber(payload.delta ?? 0);
		if (!player || delta === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					lifeTotal: currentState[player].lifeTotal + delta,
				},
			},
		};
	}

	if (type === 'SetLife') {
		const player = playerSideOf(payload.player);
		const lifeTotal = finiteNumber(payload.lifeTotal);
		if (!player || lifeTotal === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					lifeTotal,
				},
			},
		};
	}

	if (type === 'SetCounters') {
		const player = playerSideOf(payload.player);
		const counters = countersOf(payload.counters);
		if (!player || counters === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					counters,
				},
			},
		};
	}

	if (type === 'SetCardsKept') {
		const player = playerSideOf(payload.player);
		const cardsKept = finiteNumber(payload.cardsKept);
		if (!player || cardsKept === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					cardsKept,
				},
			},
		};
	}

	if (type === 'AdjustClock') {
		const at = finiteNumber(payload.at);
		const deltaDisplayMs = finiteNumber(payload.deltaMs ?? 0);
		if (at === null || deltaDisplayMs === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: applyClockAdjustment(currentState.clock, at, { deltaDisplayMs }),
			},
		};
	}

	if (type === 'SetClock') {
		const at = finiteNumber(payload.at);
		const targetDisplayMs = finiteNumber(payload.targetMs ?? 0);
		if (at === null || targetDisplayMs === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: applyClockAdjustment(currentState.clock, at, { targetDisplayMs }),
			},
		};
	}

	if (type === 'StartClock') {
		const at = finiteNumber(payload.at);
		if (at === null)
			return null;
		if (currentState.clock.isRunning)
			return { currentState, sourceSnapshot };
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: { ...currentState.clock, isRunning: true, lastStartedAt: at },
			},
		};
	}

	if (type === 'PauseClock') {
		const at = finiteNumber(payload.at);
		if (at === null)
			return null;
		if (!currentState.clock.isRunning)
			return { currentState, sourceSnapshot };
		const additionalElapsed = currentState.clock.lastStartedAt ? at - currentState.clock.lastStartedAt : 0;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: {
					...currentState.clock,
					isRunning: false,
					elapsedMs: currentState.clock.elapsedMs + additionalElapsed,
					lastStartedAt: null,
				},
			},
		};
	}

	if (type === 'ResetClock') {
		const durationMs = payload.durationMs == null ? undefined : finiteNumber(payload.durationMs);
		if (durationMs === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: {
					...currentState.clock,
					elapsedMs: 0,
					isRunning: false,
					lastStartedAt: null,
					...(durationMs !== undefined && { durationMs }),
				},
				overtime: undefined,
			},
		};
	}

	if (type === 'RestartClock') {
		const at = finiteNumber(payload.at);
		if (at === null)
			return null;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: { ...currentState.clock, elapsedMs: 0, isRunning: true, lastStartedAt: at },
			},
		};
	}

	if (type === 'SelectFirstPlayer') {
		const player = playerSideOf(payload.player);
		if (!player)
			return null;
		return {
			sourceSnapshot,
			currentState: { ...currentState, firstPlayer: player, activePlayer: player, turnNumber: 1 },
		};
	}

	if (type === 'SetFirstPlayer') {
		const player = playerSideOf(payload.player);
		if (!player)
			return null;
		return {
			sourceSnapshot,
			currentState: { ...currentState, firstPlayer: player },
		};
	}

	if (type === 'SetActivePlayer') {
		const player = playerSideOf(payload.player);
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
					counters: resetCounters ? [] : winner.counters,
					cardsKept: resetLife ? undefined : winner.cardsKept,
				},
				[opponent]: {
					...currentState[opponent],
					lifeTotal: resetLife ? startingLife : currentState[opponent].lifeTotal,
					counters: resetCounters ? [] : currentState[opponent].counters,
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

		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					gameWins: currentState[player].gameWins - 1,
					lifeTotal: resetLife ? startingLife : currentState[player].lifeTotal,
					counters: resetCounters ? [] : currentState[player].counters,
				},
				[opponent]: {
					...currentState[opponent],
					lifeTotal: resetLife ? startingLife : currentState[opponent].lifeTotal,
					counters: resetCounters ? [] : currentState[opponent].counters,
				},
				currentGame: Math.max(1, currentState.currentGame - 1),
				isComplete: false,
			},
		};
	}

	if (type === 'ResetState') {
		const startingLife = finiteNumber(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);
		if (startingLife === null)
			return null;
		if (payload.type === 'match') {
			return { sourceSnapshot, currentState: createInitialFeatureMatchSessionStateFromSnapshot(sourceSnapshot) };
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
			currentState: { ...currentState, overtime: createInitialOvertimeState(totalTurns) },
		};
	}

	if (type === 'StepTurn') {
		const delta = finiteNumber(payload.delta ?? 0);
		if (delta === null)
			return null;
		return {
			sourceSnapshot,
			currentState: applyFeatureMatchTurnStep(currentState, delta),
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
		const swappedActivePlayer = currentState.activePlayer ? otherFeatureMatchPlayer(currentState.activePlayer) : currentState.activePlayer;
		const swappedFirstPlayer = currentState.firstPlayer ? otherFeatureMatchPlayer(currentState.firstPlayer) : currentState.firstPlayer;
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
