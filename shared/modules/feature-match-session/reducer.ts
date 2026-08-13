import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
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

export function normalizeFeatureMatchSessionCommandPayload(
	type: FeatureMatchCommandType,
	payload: FeatureMatchSessionEventPayload,
	now: () => number = Date.now,
): FeatureMatchSessionEventPayload {
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
 * Re-apply a Session's player orientation to a snapshot rebuilt from its Slot.
 *
 * A `SnapshotCorrected` payload always comes from `buildSourceSnapshot`, which
 * reads the Slot row and so knows nothing about `SwapPlayers` — it arrives in
 * Slot order every time. Orientation belongs to the Session, so the correction
 * carries the Slot's facts and the Session keeps its own sides.
 */
function orientSourceSnapshot(snapshot: FeatureMatchSourceSnapshot, swapped: boolean): FeatureMatchSourceSnapshot {
	if (!swapped)
		return snapshot;

	return {
		...snapshot,
		player1: snapshot.player2,
		player2: snapshot.player1,
		playersSwapped: true,
	};
}

export function applyFeatureMatchSessionEvent(
	currentState: FeatureMatchState,
	sourceSnapshot: FeatureMatchSourceSnapshot,
	type: FeatureMatchCommandType | 'SessionStarted' | 'SnapshotCorrected',
	payload: FeatureMatchSessionEventPayload,
): FeatureMatchSessionReducerResult {
	if (type === 'SessionStarted') {
		return {
			currentState: payload.currentState as FeatureMatchState,
			sourceSnapshot: payload.sourceSnapshot as FeatureMatchSourceSnapshot,
		};
	}

	if (type === 'SnapshotCorrected') {
		return {
			currentState,
			sourceSnapshot: orientSourceSnapshot(
				payload.sourceSnapshot as FeatureMatchSourceSnapshot,
				sourceSnapshot.playersSwapped ?? false,
			),
		};
	}

	if (type === 'AdjustLife') {
		const player = payload.player as PlayerSide;
		const delta = Number(payload.delta ?? 0);
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
		const player = payload.player as PlayerSide;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					lifeTotal: Number(payload.lifeTotal),
				},
			},
		};
	}

	if (type === 'SetCounters') {
		const player = payload.player as PlayerSide;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					counters: payload.counters as { type: string; value: number }[],
				},
			},
		};
	}

	if (type === 'SetCardsKept') {
		const player = payload.player as PlayerSide;
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				[player]: {
					...currentState[player],
					cardsKept: Number(payload.cardsKept),
				},
			},
		};
	}

	if (type === 'AdjustClock') {
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: applyClockAdjustment(currentState.clock, Number(payload.at), { deltaDisplayMs: Number(payload.deltaMs ?? 0) }),
			},
		};
	}

	if (type === 'SetClock') {
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: applyClockAdjustment(currentState.clock, Number(payload.at), { targetDisplayMs: Number(payload.targetMs ?? 0) }),
			},
		};
	}

	if (type === 'StartClock') {
		if (currentState.clock.isRunning)
			return { currentState, sourceSnapshot };
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: { ...currentState.clock, isRunning: true, lastStartedAt: Number(payload.at) },
			},
		};
	}

	if (type === 'PauseClock') {
		if (!currentState.clock.isRunning)
			return { currentState, sourceSnapshot };
		const additionalElapsed = currentState.clock.lastStartedAt ? Number(payload.at) - currentState.clock.lastStartedAt : 0;
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
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: {
					...currentState.clock,
					elapsedMs: 0,
					isRunning: false,
					lastStartedAt: null,
					...(payload.durationMs !== undefined && { durationMs: Number(payload.durationMs) }),
				},
				overtime: undefined,
			},
		};
	}

	if (type === 'RestartClock') {
		return {
			sourceSnapshot,
			currentState: {
				...currentState,
				clock: { ...currentState.clock, elapsedMs: 0, isRunning: true, lastStartedAt: Number(payload.at) },
			},
		};
	}

	if (type === 'SelectFirstPlayer') {
		const player = payload.player as PlayerSide;
		return {
			sourceSnapshot,
			currentState: { ...currentState, firstPlayer: player, activePlayer: player, turnNumber: 1 },
		};
	}

	if (type === 'SetFirstPlayer') {
		return {
			sourceSnapshot,
			currentState: { ...currentState, firstPlayer: payload.player as PlayerSide },
		};
	}

	if (type === 'SetActivePlayer') {
		return {
			sourceSnapshot,
			currentState: { ...currentState, activePlayer: payload.player as PlayerSide | null },
		};
	}

	if (type === 'SetTurnNumber') {
		return {
			sourceSnapshot,
			currentState: { ...currentState, turnNumber: Number(payload.turnNumber) },
		};
	}

	if (type === 'RecordGameWin') {
		const player = payload.player as PlayerSide;
		const opponent = otherFeatureMatchPlayer(player);
		const resetLife = payload.resetLife !== false;
		const resetCounters = payload.resetCounters !== false;
		const startingLife = Number(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);
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
		const player = payload.player as PlayerSide;
		if (currentState[player].gameWins <= 0)
			return { currentState, sourceSnapshot };
		const opponent = otherFeatureMatchPlayer(player);
		const resetLife = payload.resetLife === true;
		const resetCounters = payload.resetCounters === true;
		const startingLife = Number(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);

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
		const startingLife = Number(payload.startingLife ?? sourceSnapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE);
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
		return {
			sourceSnapshot,
			currentState: { ...currentState, overtime: createInitialOvertimeState(Number(payload.totalTurns)) },
		};
	}

	if (type === 'StepTurn') {
		return {
			sourceSnapshot,
			currentState: applyFeatureMatchTurnStep(currentState, Number(payload.delta ?? 0)),
		};
	}

	if (type === 'StepOvertime') {
		return {
			sourceSnapshot,
			currentState: applyFeatureMatchOvertimeStep(currentState, Number(payload.delta ?? 0)),
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
