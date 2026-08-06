import type { BulkClockAction, ClockType, PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState, GameWinOptions, PlayerFeatureMatchStateUpdate } from '~~/shared/types/featureMatchState';
import type {
	FeatureMatchCommandStateResult,
	FeatureMatchResetOptions,
	FeatureMatchStateUpdate,
} from '~/modules/feature-match-session/client';
import type { MessageData } from '~/types/realtime';
import { applyClockAdjustment, applyFeatureMatchOvertimeStep, applyFeatureMatchTurnStep, otherFeatureMatchPlayer } from '~~/shared/modules/feature-match-session';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { useFeatureMatchSessionClient } from '~/modules/feature-match-session/client';
import { createOptimisticState } from '~/modules/optimistic-state';

export const useFeatureMatchStateStore = defineStore('featureMatchState', () => {
	const repo = useFeatureMatchSessionClient();
	const { executeReporting } = useReportingAction();
	const { getServerTime } = useServerTime();

	// State: Map of featureMatchId -> FeatureMatchState
	const featureMatchStates = ref<Map<number, FeatureMatchState>>(new Map());
	const featureMatchSessions = ref<Map<number, FeatureMatchSessionResponse>>(new Map());
	const sessionIdBySlotId = ref<Map<number, number>>(new Map());
	const sessionSequenceBySlotId = ref<Map<number, number>>(new Map());
	const activeFeatureMatchId = ref<number | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const currentEventId = ref<number | null>(null);

	// ──────────────── Optimistic State ────────────────
	// One ownership core for every batched, immediate, and bulk edit: Field
	// Ownership is derived from each action's optimistic diff, and remote or
	// server-authoritative full states merge around whatever is still pending.
	const optimistic = createOptimisticState<FeatureMatchState>({
		stateMap: featureMatchStates,
		errorRef: error,
	});

	// Player state batch (life totals, counters)
	interface PlayerBatchPayload {
		eventId: number;
		matchId: number;
		player: PlayerSide;
		/** Accumulated relative life adjustment. Kept mergeable server-side. */
		lifeDelta: number;
		/** Latest absolute life target. Takes precedence when direct entry/sliders are used. */
		intendedLifeTotal: number | null;
		latestCounters?: { type: string; value: number }[];
		hasAbsoluteLifeUpdate: boolean;
		hasCounterUpdate: boolean;
	}
	const playerBatch = optimistic.batch<PlayerBatchPayload>({
		flush: async (entry) => {
			const apiUpdate: PlayerFeatureMatchStateUpdate = {};
			if (entry.payload.hasAbsoluteLifeUpdate && entry.payload.intendedLifeTotal !== null) {
				apiUpdate.lifeTotal = entry.payload.intendedLifeTotal;
			}
			else if (entry.payload.lifeDelta !== 0) {
				apiUpdate.lifeDelta = entry.payload.lifeDelta;
			}
			if (entry.payload.hasCounterUpdate) {
				apiUpdate.counters = entry.payload.latestCounters;
			}
			return cacheCommandResult(await repo.updatePlayerFeatureMatchState(
				entry.payload.eventId,
				entry.payload.matchId,
				entry.payload.player,
				apiUpdate,
			), { skipStateWrite: true });
		},
	});

	// Clock adjust batch (accumulates deltaMs)
	interface ClockAdjustPayload {
		eventId: number;
		matchId: number;
		totalDeltaMs: number;
	}
	const clockAdjustBatch = optimistic.batch<ClockAdjustPayload>({
		flush: async entry => cacheCommandResult(await repo.adjustClock(entry.payload.eventId, entry.payload.matchId, entry.payload.totalDeltaMs), { skipStateWrite: true }),
	});

	// Turn + overtime step batch. Both actions are user-clickable at the same time
	// (the overtime stepper stays visible once overtime has started, independent of
	// normal turn tracking — see useFeatureMatchGameMode's showTurnCounter) and both
	// mutate `activePlayer` as a side effect. A single shared batcher/key serializes
	// them and, when both deltas land in the same window, sends the turn-step command
	// before the overtime-step command so the final flush result already reflects both
	// effects combined — avoiding any ambiguity about which flush "owns" activePlayer.
	interface TurnBatchPayload {
		eventId: number;
		matchId: number;
		turnDelta: number;
		overtimeDelta: number;
	}
	const turnBatch = optimistic.batch<TurnBatchPayload>({
		flush: async (entry, controls) => {
			let latest: FeatureMatchState | undefined;
			if (entry.payload.turnDelta !== 0) {
				const result = await repo.stepTurn(entry.payload.eventId, entry.payload.matchId, entry.payload.turnDelta);
				latest = cacheCommandResult(result, { skipStateWrite: true });
				// If the overtime step below fails, rollback keeps this confirmed
				// turn step instead of reverting the whole batch.
				controls.commit(latest);
			}
			if (entry.payload.overtimeDelta !== 0) {
				const result = await repo.stepOvertime(entry.payload.eventId, entry.payload.matchId, entry.payload.overtimeDelta);
				latest = cacheCommandResult(result, { skipStateWrite: true });
			}
			// Net-zero batch (or both deltas cancelled out) — skip API calls entirely.
			return latest ?? featureMatchStates.value.get(entry.id) ?? entry.snapshot;
		},
	});

	// Bulk clock adjust batch (one accumulated API call across ALL feature matches)
	interface BulkAdjustPayload {
		eventId: number;
		totalDeltaMs: number;
	}
	const bulkAdjustBatch = optimistic.batch<BulkAdjustPayload>({
		flush: async (entry) => {
			if (entry.payload.totalDeltaMs === 0)
				return null;
			const result = await repo.bulkClockAction(entry.payload.eventId, 'adjust', entry.payload.totalDeltaMs);
			return cacheBulkUpdates(result?.updates);
		},
	});

	function cacheBulkUpdates(updates: FeatureMatchCommandStateResult[] | undefined): ReadonlyMap<number, FeatureMatchState> {
		const states = new Map<number, FeatureMatchState>();
		for (const update of updates ?? [])
			states.set(update.session.slotId, cacheSessionOnly(update));
		return states;
	}

	// Computed
	const activeState = computed(() => {
		if (!activeFeatureMatchId.value)
			return null;
		return featureMatchStates.value.get(activeFeatureMatchId.value) ?? null;
	});

	// ──────────────── Internal Helpers ────────────────

	/**
	 * @param session - Session response to cache.
	 * @param options - Optional behavior flags.
	 * @param options.skipStateWrite - When true, updates session/sequence bookkeeping only
	 *   and leaves `featureMatchStates` untouched. Used by the batched-update flushes below,
	 *   which merge their own field-scoped slice of the result via `applyResult` instead
	 *   — writing the full state here would race ahead of that merge and clobber
	 *   concurrent edits still pending under another batch key for the same match.
	 */
	function cacheSession(session: FeatureMatchSessionResponse, options?: { skipStateWrite?: boolean }) {
		featureMatchSessions.value.set(session.id, session);
		sessionIdBySlotId.value.set(session.slotId, session.id);
		sessionSequenceBySlotId.value.set(session.slotId, session.sequence);
		if (!options?.skipStateWrite)
			featureMatchStates.value.set(session.slotId, session.currentState);
	}

	function cacheSlotSession(slot: { activeSession?: FeatureMatchSessionResponse | null }) {
		if (slot.activeSession) {
			cacheSession(slot.activeSession, { skipStateWrite: true });
			optimistic.applyRemote(slot.activeSession.slotId, slot.activeSession.currentState);
		}
	}

	function cacheCommandResult(result: FeatureMatchCommandStateResult, options?: { skipStateWrite?: boolean }): FeatureMatchState {
		cacheSession(result.session, options);
		return result.featureMatchState;
	}

	/**
	 * Session-bookkeeping-only variant for ownership-scoped actions: the
	 * optimistic-state module merges its owned slice of the returned state
	 * itself, so writing the full state here would clobber concurrent edits
	 * pending under other actions.
	 */
	function cacheSessionOnly(result: FeatureMatchCommandStateResult): FeatureMatchState {
		return cacheCommandResult(result, { skipStateWrite: true });
	}

	function cacheRemoteSessionEvent(data: MessageData<'featureMatchSession:eventApplied'>) {
		const existing = featureMatchSessions.value.get(data.sessionId);
		const timestamp = new Date(data.timestamp);
		cacheSession({
			id: data.sessionId,
			eventId: data.eventId,
			slotId: data.slotId,
			status: existing?.status ?? 'active',
			sourceSnapshot: data.sourceSnapshot,
			currentState: data.currentState,
			sequence: data.sequence,
			closedAt: existing?.closedAt ?? null,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
		}, { skipStateWrite: true });
		// Remote state merges around any pending or in-flight local edit's
		// Field Ownership instead of overwriting the whole state.
		optimistic.applyRemote(data.slotId, data.currentState);
	}

	/**
	 * Server-only update (no optimistic prediction). The full server state
	 * still applies through the ownership merge so it cannot clobber a
	 * concurrent edit's pending fields.
	 */
	function withServerUpdate(
		matchId: number,
		apiCall: () => Promise<FeatureMatchState>,
	) {
		const current = featureMatchStates.value.get(matchId);
		if (!current)
			return null;

		return executeReporting(
			async () => {
				const state = await apiCall();
				optimistic.applyRemote(matchId, state);
				return state;
			},
			{ errorRef: error },
		);
	}

	// ──────────────── State Management ────────────────

	async function loadState(eventId: number, matchId: number) {
		currentEventId.value = eventId;
		return executeReporting(
			async () => {
				const session = await repo.ensureSession(eventId, matchId);
				if (!session)
					throw new Error('Feature match session not found');
				cacheSession(session, { skipStateWrite: true });
				const state = session.currentState;
				optimistic.applyRemote(matchId, state);
				return state;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	function setActiveFeatureMatch(matchId: number | null) {
		activeFeatureMatchId.value = matchId;
	}

	// ──────────────── Feature Match State ────────────────

	function updateState(eventId: number, matchId: number, update: FeatureMatchStateUpdate) {
		return optimistic.run(
			null,
			matchId,
			current => ({
				...current,
				...update,
				player1: update.player1 ? { ...current.player1, ...update.player1 } : current.player1,
				player2: update.player2 ? { ...current.player2, ...update.player2 } : current.player2,
				clock: update.clock ? { ...current.clock, ...update.clock } : current.clock,
			}),
			() => repo.updateState(eventId, matchId, update).then(cacheSessionOnly),
		);
	}

	// ──────────────── Clock Actions ────────────────

	function startClock(eventId: number, matchId: number) {
		return optimistic.run(
			`clock:start:${matchId}`,
			matchId,
			current => ({
				...current,
				clock: { ...current.clock, isRunning: true, lastStartedAt: getServerTime() },
			}),
			() => repo.startClock(eventId, matchId).then(cacheSessionOnly),
		);
	}

	function pauseClock(eventId: number, matchId: number) {
		if (!featureMatchStates.value.get(matchId)?.clock.isRunning)
			return null;

		return optimistic.run(
			`clock:pause:${matchId}`,
			matchId,
			(current) => {
				const now = getServerTime();
				const additionalElapsed = current.clock.lastStartedAt
					? now - current.clock.lastStartedAt
					: 0;
				return {
					...current,
					clock: {
						...current.clock,
						isRunning: false,
						elapsedMs: current.clock.elapsedMs + additionalElapsed,
						lastStartedAt: null,
					},
				};
			},
			() => repo.pauseClock(eventId, matchId).then(cacheSessionOnly),
		);
	}

	function resetClock(eventId: number, matchId: number) {
		return optimistic.run(
			`clock:reset:${matchId}`,
			matchId,
			current => ({
				...current,
				clock: { ...current.clock, elapsedMs: 0, isRunning: false, lastStartedAt: null },
				overtime: undefined,
			}),
			() => repo.resetClock(eventId, matchId).then(cacheSessionOnly),
			// `overtime` may already be unset — the server still clears it on reset.
			{ serverOwns: ['overtime'] },
		);
	}

	function restartClock(eventId: number, matchId: number) {
		return optimistic.run(
			`clock:restart:${matchId}`,
			matchId,
			current => ({
				...current,
				clock: { ...current.clock, elapsedMs: 0, isRunning: true, lastStartedAt: getServerTime() },
			}),
			() => repo.restartClock(eventId, matchId).then(cacheSessionOnly),
		);
	}

	function adjustClock(eventId: number, matchId: number, deltaMs: number) {
		clockAdjustBatch.enqueue(
			`${matchId}`,
			matchId,
			current => ({
				...current,
				clock: applyClockAdjustment(current.clock, getServerTime(), { deltaDisplayMs: deltaMs }),
			}),
			existing => ({
				eventId,
				matchId,
				totalDeltaMs: (existing?.totalDeltaMs ?? 0) + deltaMs,
			}),
		);
	}

	function setClock(eventId: number, matchId: number, targetMs: number) {
		return optimistic.run(
			`clock:set:${matchId}`,
			matchId,
			current => ({
				...current,
				clock: applyClockAdjustment(current.clock, getServerTime(), { targetDisplayMs: targetMs }),
			}),
			() => repo.setClock(eventId, matchId, targetMs).then(cacheSessionOnly),
		);
	}

	// ──────────────── Bulk Clock Actions ────────────────

	function bulkClockAction(eventId: number, action: BulkClockAction, deltaMs?: number) {
		const now = getServerTime();

		// For 'reset', resolve event default duration so clocks reset to the configured default
		const eventStore = useEventStore();
		const defaults = toFeatureMatchDefaults(eventStore.event);
		const defaultDurationMs = action === 'reset' && defaults.clockDuration
			? defaults.clockDuration * 60 * 1000
			: undefined;

		return optimistic.run(
			`bulk:${action}`,
			[...featureMatchStates.value.keys()],
			state => computeBulkClockOptimistic(state, action, now, deltaMs, defaultDurationMs),
			async () => cacheBulkUpdates((await repo.bulkClockAction(eventId, action, deltaMs))?.updates ?? undefined),
			// 'reset' clears overtime server-side even when it is already unset.
			action === 'reset' ? { serverOwns: ['overtime'] } : undefined,
		);
	}

	function computeBulkClockOptimistic(
		state: FeatureMatchState,
		action: BulkClockAction,
		now: number,
		deltaMs?: number,
		defaultDurationMs?: number,
	): FeatureMatchState | null {
		switch (action) {
			case 'start':
				return state.clock.isRunning
					? null
					: { ...state, clock: { ...state.clock, isRunning: true, lastStartedAt: now } };
			case 'pause': {
				if (!state.clock.isRunning)
					return null;
				const additionalElapsed = state.clock.lastStartedAt ? now - state.clock.lastStartedAt : 0;
				return { ...state, clock: { ...state.clock, isRunning: false, elapsedMs: state.clock.elapsedMs + additionalElapsed, lastStartedAt: null } };
			}
			case 'reset':
				return { ...state, clock: { ...state.clock, elapsedMs: 0, isRunning: false, lastStartedAt: null, ...(defaultDurationMs !== undefined && { durationMs: defaultDurationMs }) }, overtime: undefined };
			case 'restart':
				return { ...state, clock: { ...state.clock, elapsedMs: 0, isRunning: true, lastStartedAt: now } };
			case 'adjust':
				return deltaMs !== undefined
					? { ...state, clock: applyClockAdjustment(state.clock, now, { deltaDisplayMs: deltaMs }) }
					: null;
		}
	}

	function startAllClocks(eventId: number) {
		return bulkClockAction(eventId, 'start');
	}
	function pauseAllClocks(eventId: number) {
		return bulkClockAction(eventId, 'pause');
	}
	function resetAllClocks(eventId: number) {
		return bulkClockAction(eventId, 'reset');
	}
	function restartAllClocks(eventId: number) {
		return bulkClockAction(eventId, 'restart');
	}
	function adjustAllClocks(eventId: number, deltaMs: number) {
		const now = getServerTime();
		bulkAdjustBatch.enqueue(
			'all',
			[...featureMatchStates.value.keys()],
			state => ({
				...state,
				clock: applyClockAdjustment(state.clock, now, { deltaDisplayMs: deltaMs }),
			}),
			existing => ({
				eventId,
				totalDeltaMs: (existing?.totalDeltaMs ?? 0) + deltaMs,
			}),
		);
	}

	// ──────────────── Player Feature Match State ────────────────

	function updatePlayerFeatureMatchState(
		eventId: number,
		matchId: number,
		player: PlayerSide,
		update: PlayerFeatureMatchStateUpdate,
	) {
		const current = featureMatchStates.value.get(matchId);
		if (!current)
			return;

		// Compute the optimistic display value from the latest local state so rapid
		// button taps stay responsive while the server receives one batched command.
		const currentPlayer = current[player];
		const newLifeTotal = update.lifeTotal !== undefined
			? update.lifeTotal
			: update.lifeDelta !== undefined
				? currentPlayer.lifeTotal + update.lifeDelta
				: currentPlayer.lifeTotal;

		playerBatch.enqueue(
			`${matchId}-${player}`,
			matchId,
			current => ({
				...current,
				[player]: {
					...current[player],
					lifeTotal: newLifeTotal,
					counters: update.counters ?? current[player].counters,
				},
			}),
			(existing) => {
				const hasAbsoluteLifeUpdate = update.lifeTotal !== undefined || (existing?.hasAbsoluteLifeUpdate ?? false);
				return {
					eventId,
					matchId,
					player,
					lifeDelta: (existing?.lifeDelta ?? 0) + (update.lifeDelta ?? 0),
					intendedLifeTotal: hasAbsoluteLifeUpdate ? newLifeTotal : (existing?.intendedLifeTotal ?? null),
					latestCounters: update.counters ?? existing?.latestCounters,
					hasAbsoluteLifeUpdate,
					hasCounterUpdate: !!update.counters || (existing?.hasCounterUpdate ?? false),
				};
			},
		);
	}

	function adjustLife(eventId: number, matchId: number, player: PlayerSide, delta: number) {
		return updatePlayerFeatureMatchState(eventId, matchId, player, { lifeDelta: delta });
	}

	function setLife(eventId: number, matchId: number, player: PlayerSide, lifeTotal: number) {
		return updatePlayerFeatureMatchState(eventId, matchId, player, { lifeTotal });
	}

	function setCardsKept(eventId: number, matchId: number, player: PlayerSide, cardsKept: number) {
		return optimistic.run(
			`cards:${matchId}:${player}`,
			matchId,
			current => ({
				...current,
				[player]: { ...current[player], cardsKept },
			}),
			() => repo.updatePlayerFeatureMatchState(eventId, matchId, player, { cardsKept }).then(cacheSessionOnly),
		);
	}

	function setTurnNumber(eventId: number, matchId: number, turnNumber: number) {
		return optimistic.run(
			`turnNumber:${matchId}`,
			matchId,
			current => ({ ...current, turnNumber }),
			() => repo.updateState(eventId, matchId, { turnNumber }).then(cacheSessionOnly),
			// The server treats an explicit turn number as owning the field even
			// when it matches the current value.
			{ serverOwns: ['turnNumber'] },
		);
	}

	function selectFirstPlayer(eventId: number, matchId: number, player: PlayerSide) {
		return optimistic.run(
			`firstPlayer:${matchId}`,
			matchId,
			current => ({ ...current, firstPlayer: player, activePlayer: player, turnNumber: 1 }),
			() => repo.updateState(eventId, matchId, { firstPlayer: player, activePlayer: player, turnNumber: 1 }).then(cacheSessionOnly),
			{ serverOwns: ['firstPlayer', 'activePlayer', 'turnNumber'] },
		);
	}

	function changeFirstPlayer(eventId: number, matchId: number) {
		const current = featureMatchStates.value.get(matchId);
		if (!current?.firstPlayer)
			return null;

		const newFirstPlayer = otherFeatureMatchPlayer(current.firstPlayer);

		return optimistic.run(
			`firstPlayer:${matchId}`,
			matchId,
			state => ({ ...state, firstPlayer: newFirstPlayer }),
			() => repo.updateState(eventId, matchId, { firstPlayer: newFirstPlayer }).then(cacheSessionOnly),
		);
	}

	/** Compute a single half-turn step on a FeatureMatchState (used for optimistic updates) */
	function computeTurnStep(state: FeatureMatchState, delta: 1 | -1): FeatureMatchState {
		return applyFeatureMatchTurnStep(state, delta);
	}

	function stepTurn(eventId: number, matchId: number, delta: 1 | -1) {
		const current = featureMatchStates.value.get(matchId);
		if (!current?.activePlayer || !current.firstPlayer)
			return;

		// Boundary check: can't step back at turn 1 with first player active
		if (delta === -1 && current.activePlayer === current.firstPlayer && current.turnNumber <= 1)
			return;

		turnBatch.enqueue(
			`${matchId}`,
			matchId,
			current => computeTurnStep(current, delta),
			existing => ({
				eventId,
				matchId,
				turnDelta: (existing?.turnDelta ?? 0) + delta,
				overtimeDelta: existing?.overtimeDelta ?? 0,
			}),
		);
	}

	function setActivePlayer(eventId: number, matchId: number, player: PlayerSide | null) {
		return optimistic.run(
			`activePlayer:${matchId}`,
			matchId,
			current => ({ ...current, activePlayer: player }),
			() => repo.updateState(eventId, matchId, { activePlayer: player }).then(cacheSessionOnly),
		);
	}

	// ──────────────── Game / Match Lifecycle ────────────────

	function recordGameWin(
		eventId: number,
		matchId: number,
		player: PlayerSide,
		options: GameWinOptions = {},
	) {
		return withServerUpdate(
			matchId,
			() => repo.recordGameWin(eventId, matchId, player, options).then(cacheSessionOnly),
		);
	}

	function undoGameWin(
		eventId: number,
		matchId: number,
		player: PlayerSide,
		options: GameWinOptions = {},
	) {
		return withServerUpdate(
			matchId,
			() => repo.undoGameWin(eventId, matchId, player, options).then(cacheSessionOnly),
		);
	}

	function resetMatch(eventId: number, matchId: number, options: FeatureMatchResetOptions) {
		return withServerUpdate(
			matchId,
			() => repo.resetMatch(eventId, matchId, options).then(cacheSessionOnly),
		);
	}

	// ──────────────── Overtime ────────────────

	function startOvertime(eventId: number, matchId: number, totalTurns: number) {
		return optimistic.run(
			`overtime:start:${matchId}`,
			matchId,
			current => ({
				...current,
				overtime: { active: true, turnsRemaining: totalTurns, totalTurns },
			}),
			() => repo.startOvertime(eventId, matchId, totalTurns).then(cacheSessionOnly),
		);
	}

	/** Compute a single overtime turn step (used for optimistic updates) */
	function computeOvertimeStep(state: FeatureMatchState, delta: 1 | -1): FeatureMatchState {
		return applyFeatureMatchOvertimeStep(state, delta);
	}

	function nextOvertimeTurn(eventId: number, matchId: number) {
		if (!featureMatchStates.value.get(matchId)?.overtime?.active)
			return;

		turnBatch.enqueue(
			`${matchId}`,
			matchId,
			current => computeOvertimeStep(current, 1),
			existing => ({
				eventId,
				matchId,
				turnDelta: existing?.turnDelta ?? 0,
				overtimeDelta: (existing?.overtimeDelta ?? 0) + 1,
			}),
		);
	}

	function prevOvertimeTurn(eventId: number, matchId: number) {
		if (!featureMatchStates.value.get(matchId)?.overtime)
			return;

		turnBatch.enqueue(
			`${matchId}`,
			matchId,
			current => computeOvertimeStep(current, -1),
			existing => ({
				eventId,
				matchId,
				turnDelta: existing?.turnDelta ?? 0,
				overtimeDelta: (existing?.overtimeDelta ?? 0) - 1,
			}),
		);
	}

	function swapPlayers(eventId: number, matchId: number) {
		return optimistic.run(
			`swap:${matchId}`,
			matchId,
			(current) => {
				const swappedActive = current.activePlayer ? otherFeatureMatchPlayer(current.activePlayer) : current.activePlayer;
				const swappedFirst = current.firstPlayer ? otherFeatureMatchPlayer(current.firstPlayer) : current.firstPlayer;
				return { ...current, player1: current.player2, player2: current.player1, activePlayer: swappedActive, firstPlayer: swappedFirst };
			},
			() => repo.swapPlayers(eventId, matchId).then(cacheSessionOnly),
		);
	}

	// ──────────────── Clock Settings ────────────────

	function updateAllClockSettings(clockType?: ClockType, durationMs?: number, countUpAfterCountdown?: boolean) {
		for (const [matchId, state] of featureMatchStates.value) {
			const updatedClock = { ...state.clock };
			if (clockType)
				updatedClock.type = clockType;
			if (durationMs !== undefined)
				updatedClock.durationMs = durationMs;
			if (countUpAfterCountdown !== undefined)
				updatedClock.countUpAfterCountdown = countUpAfterCountdown;
			featureMatchStates.value.set(matchId, { ...state, clock: updatedClock });
		}
	}

	// ──────────────── Realtime Handlers ────────────────

	async function applyRemoteSessionEvent(data: MessageData<'featureMatchSession:eventApplied'>) {
		const knownSessionId = sessionIdBySlotId.value.get(data.slotId);
		const knownSequence = sessionSequenceBySlotId.value.get(data.slotId) ?? 0;

		if (knownSessionId && knownSessionId !== data.sessionId) {
			cacheRemoteSessionEvent(data);
			return;
		}

		if (knownSequence && data.sequence <= knownSequence)
			return;

		if (knownSequence && data.sequence > knownSequence + 1) {
			await loadState(data.eventId, data.slotId);
			return;
		}

		cacheRemoteSessionEvent(data);
	}

	// ──────────────── Reset ────────────────

	function $reset() {
		// Clear all batch state
		playerBatch.reset();
		clockAdjustBatch.reset();
		turnBatch.reset();
		bulkAdjustBatch.reset();
		optimistic.reset();

		// Clear reactive state
		featureMatchStates.value.clear();
		featureMatchSessions.value.clear();
		sessionIdBySlotId.value.clear();
		sessionSequenceBySlotId.value.clear();
		activeFeatureMatchId.value = null;
		error.value = null;
		loading.value = false;
		currentEventId.value = null;
	}

	return {
		// State
		featureMatchStates,
		featureMatchSessions,
		sessionIdBySlotId,
		sessionSequenceBySlotId,
		activeFeatureMatchId,
		loading,
		error,
		currentEventId,

		// Computed
		activeState,

		// Actions
		loadState,
		updateState,
		setActiveFeatureMatch,
		startClock,
		pauseClock,
		resetClock,
		restartClock,
		adjustClock,
		setClock,
		startAllClocks,
		pauseAllClocks,
		resetAllClocks,
		restartAllClocks,
		adjustAllClocks,
		updatePlayerFeatureMatchState,
		adjustLife,
		setLife,
		setCardsKept,
		setTurnNumber,
		selectFirstPlayer,
		changeFirstPlayer,
		stepTurn,
		setActivePlayer,
		recordGameWin,
		undoGameWin,
		resetMatch,
		swapPlayers,
		startOvertime,
		nextOvertimeTurn,
		prevOvertimeTurn,
		updateAllClockSettings,
		cacheSession,
		cacheSlotSession,
		applyRemoteSessionEvent,
		$reset,
	};
});
