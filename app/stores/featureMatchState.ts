import type { FeatureMatchClockCommandType } from '~~/shared/modules/feature-match-session';
import type { BulkClockAction, PlayerSide, Seat } from '~~/shared/types/enums';
import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import type { CommanderSource, FeatureMatchOutcome, FeatureMatchState, GameWinOptions, PlayerFeatureMatchStateUpdate } from '~~/shared/types/featureMatchState';
import type {
	FeatureMatchCommandStateResult,
	FeatureMatchResetOptions,
	FeatureMatchStateUpdate,
} from '~/modules/feature-match-session/client';
import type { MessageData } from '~/types/realtime';
import {
	applyCommanderDamage,
	applyCommanderTurnStep,
	applyFeatureMatchClockCommand,
	applyFeatureMatchOvertimeStep,
	applyFeatureMatchTurnStep,
	isCommanderSession,
	otherFeatureMatchPlayer,
	pairSeatOf,
} from '~~/shared/modules/feature-match-session';
import { useFeatureMatchSessionClient } from '~/modules/feature-match-session/client';
import { createLiveStateFollower } from '~/modules/live-state/follower';
import { createOptimisticState } from '~/modules/optimistic-state';

/** A Slot read or announcement, as far as its Session orders it. */
interface OfferedSlot {
	id: number;
	activeSession?: FeatureMatchSessionResponse | null;
}

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
	/** Commander Damage from one opposing Commander, accumulated over a batch. */
	interface CommanderDamageDelta extends CommanderSource {
		delta: number;
	}
	interface PlayerBatchPayload {
		eventId: number;
		matchId: number;
		player: Seat;
		/** Accumulated relative life adjustment. Kept mergeable server-side. */
		lifeDelta: number;
		/** Latest absolute life target. Takes precedence when direct entry/sliders are used. */
		intendedLifeTotal: number | null;
		latestCounters?: { type: string; value: number }[];
		hasAbsoluteLifeUpdate: boolean;
		hasCounterUpdate: boolean;
		/** A Commander Session's alone: sent ahead of the Seat's life and counters. */
		commanderDamage?: CommanderDamageDelta[];
	}
	const playerBatch = optimistic.batch<PlayerBatchPayload>({
		flush: async (entry, controls) => {
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
			const damage = (entry.payload.commanderDamage ?? []).filter(dealt => dealt.delta !== 0);
			const updatesSeat = Object.keys(apiUpdate).length > 0;
			// Commander Damage entered and taken back within one batch sends nothing.
			if (entry.payload.commanderDamage && damage.length === 0 && !updatesSeat)
				return featureMatchStates.value.get(entry.id) ?? entry.snapshot;
			// Damage goes first: a life the operator typed in the same window is the
			// life they saw with the damage already on it, so it lands last and holds.
			let latest: FeatureMatchState | undefined;
			for (const dealt of damage) {
				latest = settleCommandResult(await repo.adjustCommanderDamage(
					entry.payload.eventId,
					entry.payload.matchId,
					entry.payload.player,
					dealt,
					dealt.delta,
				));
				// A later refusal keeps what the Session already confirmed.
				controls.commit(latest);
			}
			if (damage.length === 0 || updatesSeat) {
				latest = settleCommandResult(await repo.updatePlayerFeatureMatchState(
					entry.payload.eventId,
					entry.payload.matchId,
					entry.payload.player,
					apiUpdate,
				));
			}
			return latest;
		},
	});

	// Clock adjust batch (accumulates deltaMs)
	interface ClockAdjustPayload {
		eventId: number;
		matchId: number;
		totalDeltaMs: number;
	}
	const clockAdjustBatch = optimistic.batch<ClockAdjustPayload>({
		flush: async entry => settleCommandResult(await repo.adjustClock(entry.payload.eventId, entry.payload.matchId, entry.payload.totalDeltaMs)),
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
				latest = settleCommandResult(result);
				// If the overtime step below fails, rollback keeps this confirmed
				// turn step instead of reverting the whole batch.
				controls.commit(latest);
			}
			if (entry.payload.overtimeDelta !== 0) {
				const result = await repo.stepOvertime(entry.payload.eventId, entry.payload.matchId, entry.payload.overtimeDelta);
				latest = settleCommandResult(result);
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
			states.set(update.session.slotId, settleCommandResult(update));
		return states;
	}

	// Computed
	const activeState = computed(() => {
		if (!activeFeatureMatchId.value)
			return null;
		return featureMatchStates.value.get(activeFeatureMatchId.value) ?? null;
	});

	// ──────────────── Following the Session ────────────────

	function heldSession(slotId: number) {
		const sessionId = sessionIdBySlotId.value.get(slotId);
		return sessionId === undefined
			? undefined
			: featureMatchSessions.value.get(sessionId);
	}

	/**
	 * Hold one Slot's Session. Its state merges around every pending or in-flight
	 * local edit's Field Ownership; each of those settles its own fields.
	 */
	function holdSession(session: FeatureMatchSessionResponse) {
		featureMatchSessions.value.set(session.id, session);
		sessionIdBySlotId.value.set(session.slotId, session.id);
		sessionSequenceBySlotId.value.set(session.slotId, session.sequence);
		optimistic.applyRemote(session.slotId, session.currentState);
	}

	/** The Session one notification describes: every one carries the whole state it produced. */
	function sessionOf(data: MessageData<'featureMatchSession:eventApplied'>, known?: FeatureMatchSessionResponse): FeatureMatchSessionResponse {
		const timestamp = new Date(data.timestamp);
		return {
			id: data.sessionId,
			eventId: data.eventId,
			slotId: data.slotId,
			status: known?.status ?? 'active',
			sourceSnapshot: data.sourceSnapshot,
			currentState: data.currentState,
			sequence: data.sequence,
			closedAt: known?.closedAt ?? null,
			createdAt: known?.createdAt ?? timestamp,
			updatedAt: timestamp,
		};
	}

	/**
	 * Follows each Slot's Feature Match Session, one Slot at a time: an operator
	 * working several Slots has several independent orders.
	 *
	 * Every `featureMatchSession:eventApplied` carries the whole state its command
	 * produced, so a difference and a snapshot are both read off it by `sessionOf`,
	 * and a notification opening a newer Session is held without a reload.
	 */
	const follower = createLiveStateFollower<
		number,
		FeatureMatchSessionResponse,
		MessageData<'featureMatchSession:eventApplied'>
	>({
		keyOf: session => session.slotId,
		held: heldSession,
		applyState: holdSession,
		withDifference: (known, data) => sessionOf(data, known),
		forget: (slotId) => {
			const sessionId = sessionIdBySlotId.value.get(slotId);
			if (sessionId !== undefined)
				featureMatchSessions.value.delete(sessionId);
			sessionIdBySlotId.value.delete(slotId);
			sessionSequenceBySlotId.value.delete(slotId);
		},
		snapshotOf: data => sessionOf(data, featureMatchSessions.value.get(data.sessionId)),
	});

	/** Hold a Session known to be the newest this client has. */
	function cacheSession(session: FeatureMatchSessionResponse) {
		follower.acceptSnapshot(session);
	}

	/**
	 * Offer the Session a Slot read or announcement carries. The Slot was read at
	 * some moment and may arrive after newer Session state, so its Session is held
	 * only when not behind. Answers whether the Slot is current: false when its
	 * Session's epoch has ended, so the Slot was read before a newer promotion or
	 * clearing and nothing it says is newer than what is held.
	 *
	 * A Slot with no Session is behind any Session held for it: no server path
	 * ends a Slot's Session without opening its successor in the same commit, so
	 * one read without a Session was read before its first opened (#658).
	 */
	function offerSlotSession(slot: OfferedSlot): boolean {
		return slotIsCurrent(slot, follower.acceptRead);
	}

	/** As `offerSlotSession`, for a Slot a write answered: its Session is a command result. */
	function settleSlotCommandResult(slot: OfferedSlot): boolean {
		return slotIsCurrent(slot, follower.acceptCommandResult);
	}

	function slotIsCurrent(
		slot: OfferedSlot,
		offer: (session: FeatureMatchSessionResponse) => { epochEnded: boolean },
	): boolean {
		return slot.activeSession
			? !offer(slot.activeSession).epochEnded
			: !heldSession(slot.id);
	}

	/**
	 * Settle one command's answer: the state its action's owned fields take. A
	 * late answer, older than what is held in sequence or epoch, is refused, and
	 * the newer state held answers in its place — it already includes the
	 * command, or the command's Session has ended.
	 */
	function settleCommandResult(result: FeatureMatchCommandStateResult): FeatureMatchState {
		const outcome = follower.acceptCommandResult(result.session);
		return outcome.accepted ? result.featureMatchState : outcome.held.currentState;
	}

	/**
	 * Server-only update (no optimistic prediction). Settling its answer holds
	 * the Session, which merges around every concurrent edit's pending fields.
	 */
	function withServerUpdate(
		matchId: number,
		apiCall: () => Promise<FeatureMatchState>,
	) {
		const current = featureMatchStates.value.get(matchId);
		if (!current)
			return null;

		return executeReporting(apiCall, { errorRef: error });
	}

	// ──────────────── State Management ────────────────

	/**
	 * Set when this client renders the Slot rather than controls it (#604): the
	 * Session is read through the Screen, and a Slot with no Session yet is shown
	 * as such rather than given one — an output must not start live state by
	 * reading it. The operator surface that starts the Session publishes
	 * `SessionStarted`, which this client then applies like any other event.
	 */
	let screenOutputRead: ((slotId: number) => Promise<FeatureMatchSessionResponse | null>) | null = null;

	/** Install the rendering's Session read; the answer uninstalls it when the rendering goes away. */
	function readSessionsAsScreenOutput(read: (slotId: number) => Promise<FeatureMatchSessionResponse | null>) {
		screenOutputRead = read;
		return () => {
			if (screenOutputRead === read)
				screenOutputRead = null;
		};
	}

	async function loadState(eventId: number, matchId: number) {
		currentEventId.value = eventId;
		const read = screenOutputRead;
		return executeReporting(
			async () => {
				const held = await follower.load(matchId, async () => {
					if (read)
						return read(matchId);
					const session = await repo.ensureSession(eventId, matchId);
					if (!session)
						throw new Error('Feature match session not found');
					return session;
				});
				return held?.currentState ?? null;
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
			(current) => {
				const { player1, player2, clock, overtime, ...fields } = update;
				return {
					...current,
					...fields,
					player1: player1
						? {
								...current.player1,
								...player1,
							}
						: current.player1,
					player2: player2
						? {
								...current.player2,
								...player2,
							}
						: current.player2,
					// The clock field is the display reading, so the prediction is
					// the reducer's answer to SetClock — writing the value into
					// elapsedMs would show a countdown clock's complement.
					clock: clock
						? applyFeatureMatchClockCommand(current, 'SetClock', {
							at: getServerTime(),
							targetMs: clock.targetDisplayMs,
						}).clock
						: current.clock,
					overtime: overtime
						? { active: true, turnsRemaining: overtime.totalTurns, totalTurns: overtime.totalTurns }
						: current.overtime,
				};
			},
			() => repo.updateState(eventId, matchId, update).then(settleCommandResult),
		);
	}

	// ──────────────── Clock Actions ────────────────
	// Each prediction is the Session reducer's own answer to the command sent, at
	// the estimated server time, so the answer that lands changes nothing shown.

	function startClock(eventId: number, matchId: number) {
		return optimistic.run(
			`clock:start:${matchId}`,
			matchId,
			current => applyFeatureMatchClockCommand(current, 'StartClock', {
				at: getServerTime(),
			}),
			() => repo.startClock(eventId, matchId).then(settleCommandResult),
		);
	}

	function pauseClock(eventId: number, matchId: number) {
		if (!featureMatchStates.value.get(matchId)?.clock.isRunning)
			return null;

		return optimistic.run(
			`clock:pause:${matchId}`,
			matchId,
			current => applyFeatureMatchClockCommand(current, 'PauseClock', {
				at: getServerTime(),
			}),
			() => repo.pauseClock(eventId, matchId).then(settleCommandResult),
		);
	}

	function resetClock(eventId: number, matchId: number) {
		return optimistic.run(
			`clock:reset:${matchId}`,
			matchId,
			current => applyFeatureMatchClockCommand(current, 'ResetClock', {}),
			() => repo.resetClock(eventId, matchId).then(settleCommandResult),
			// `overtime` may already be unset — the server still clears it on reset.
			{
				serverOwns: ['overtime'],
			},
		);
	}

	function restartClock(eventId: number, matchId: number) {
		return optimistic.run(
			`clock:restart:${matchId}`,
			matchId,
			current => applyFeatureMatchClockCommand(current, 'RestartClock', {
				at: getServerTime(),
			}),
			() => repo.restartClock(eventId, matchId).then(settleCommandResult),
		);
	}

	function adjustClock(eventId: number, matchId: number, deltaMs: number) {
		clockAdjustBatch.enqueue(
			`${matchId}`,
			matchId,
			current => applyFeatureMatchClockCommand(current, 'AdjustClock', {
				at: getServerTime(),
				deltaMs,
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
			current => applyFeatureMatchClockCommand(current, 'SetClock', {
				at: getServerTime(),
				targetMs,
			}),
			() => repo.setClock(eventId, matchId, targetMs).then(settleCommandResult),
		);
	}

	// ──────────────── Bulk Clock Actions ────────────────
	// A bulk action sends each Slot the command a single action would, with no
	// duration on a reset, so each Slot's prediction is the same reducer answer.

	const BULK_CLOCK_COMMANDS = {
		start: 'StartClock',
		pause: 'PauseClock',
		reset: 'ResetClock',
		restart: 'RestartClock',
		adjust: 'AdjustClock',
	} as const satisfies Record<BulkClockAction, FeatureMatchClockCommandType>;

	function bulkClockAction(eventId: number, action: Exclude<BulkClockAction, 'adjust'>) {
		const at = getServerTime();

		return optimistic.run(
			`bulk:${action}`,
			[
				...featureMatchStates.value.keys(),
			],
			(state) => {
				// A Slot the command leaves as it is takes no part in the action.
				const predicted = applyFeatureMatchClockCommand(state, BULK_CLOCK_COMMANDS[action], { at });
				return predicted === state
					? null
					: predicted;
			},
			async () => cacheBulkUpdates((await repo.bulkClockAction(eventId, action))?.updates ?? undefined),
			// 'reset' clears overtime server-side even when it is already unset.
			action === 'reset'
				? {
						serverOwns: ['overtime'],
					}
				: undefined,
		);
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
		const at = getServerTime();
		bulkAdjustBatch.enqueue(
			'all',
			[
				...featureMatchStates.value.keys(),
			],
			state => applyFeatureMatchClockCommand(state, BULK_CLOCK_COMMANDS.adjust, { at, deltaMs }),
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
		player: Seat,
		update: PlayerFeatureMatchStateUpdate,
	) {
		const current = featureMatchStates.value.get(matchId);
		// Seats 3 and 4 are a Commander Session's alone.
		const currentPlayer = current?.[player];
		if (!current || !currentPlayer)
			return;

		// Compute the optimistic display value from the latest local state so rapid
		// button taps stay responsive while the server receives one batched command.
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
					counters: update.counters ?? current[player]?.counters,
				},
			}),
			(existing) => {
				const hasAbsoluteLifeUpdate = update.lifeTotal !== undefined || (existing?.hasAbsoluteLifeUpdate ?? false);
				return {
					...existing,
					eventId,
					matchId,
					player,
					lifeDelta: (existing?.lifeDelta ?? 0) + (update.lifeDelta ?? 0),
					intendedLifeTotal: hasAbsoluteLifeUpdate
						? newLifeTotal
						: (existing?.intendedLifeTotal ?? null),
					latestCounters: update.counters ?? existing?.latestCounters,
					hasAbsoluteLifeUpdate,
					hasCounterUpdate: !!update.counters || (existing?.hasCounterUpdate ?? false),
				};
			},
		);
	}

	function adjustLife(eventId: number, matchId: number, player: Seat, delta: number) {
		return updatePlayerFeatureMatchState(eventId, matchId, player, { lifeDelta: delta });
	}

	function setLife(eventId: number, matchId: number, player: Seat, lifeTotal: number) {
		return updatePlayerFeatureMatchState(eventId, matchId, player, { lifeTotal });
	}

	// ──────────────── A Commander Session (ADR-0087) ────────────────

	/**
	 * Commander Damage entered against a Seat, or taken back. It shares the
	 * Seat's batch with its life and counters, as it moves the Seat's life too:
	 * rapid taps are one command per opposing Commander, predicted by the
	 * reducer's own rule.
	 */
	function adjustCommanderDamage(
		eventId: number,
		matchId: number,
		player: Seat,
		source: CommanderSource,
		delta: number,
	) {
		const snapshot = heldSession(matchId)?.sourceSnapshot;
		const current = featureMatchStates.value.get(matchId);
		const damaged = snapshot && current && applyCommanderDamage(current, snapshot, player, source, delta);
		if (!damaged)
			return;

		playerBatch.enqueue(
			`${matchId}-${player}`,
			matchId,
			() => damaged,
			(existing) => {
				const dealt = existing?.commanderDamage ?? [];
				const held = dealt.find(entry => entry.seat === source.seat && entry.commander === source.commander);
				return {
					eventId,
					matchId,
					player,
					lifeDelta: 0,
					intendedLifeTotal: null,
					hasAbsoluteLifeUpdate: false,
					hasCounterUpdate: false,
					...existing,
					// A life typed earlier in this window follows the damage down.
					...(existing?.hasAbsoluteLifeUpdate && { intendedLifeTotal: damaged[player]?.lifeTotal ?? existing.intendedLifeTotal }),
					commanderDamage: held
						? dealt.map(entry => entry === held
								? { ...entry, delta: entry.delta + delta }
								: entry)
						: [
								...dealt,
								{ seat: source.seat, commander: source.commander, delta },
							],
				};
			},
		);
	}

	function setEliminated(eventId: number, matchId: number, player: Seat, eliminated: boolean) {
		return optimistic.run(
			`eliminated:${matchId}:${player}`,
			matchId,
			(current) => {
				const seatState = current[player];
				return seatState
					? {
							...current,
							[player]: { ...seatState, eliminated },
						}
					: current;
			},
			() => repo.setEliminated(eventId, matchId, player, eliminated).then(settleCommandResult),
		);
	}

	/** Declares a winning Seat or a draw (`{ winner: null }`), which completes the Session; `null` takes it back. */
	function setOutcome(eventId: number, matchId: number, outcome: FeatureMatchOutcome | null) {
		return optimistic.run(
			`outcome:${matchId}`,
			matchId,
			current => ({
				...current,
				outcome: outcome ?? undefined,
				isComplete: outcome !== null,
			}),
			() => repo.setOutcome(eventId, matchId, outcome).then(settleCommandResult),
			// The answer leaves `outcome` out once it is taken back, which no diff reads as a change.
			{
				serverOwns: ['outcome', 'isComplete'],
			},
		);
	}

	function setCardsKept(eventId: number, matchId: number, player: Seat, cardsKept: number) {
		return optimistic.run(
			`cards:${matchId}:${player}`,
			matchId,
			(current) => {
				const seatState = current[player];
				return seatState
					? {
							...current,
							[player]: { ...seatState, cardsKept },
						}
					: current;
			},
			() => repo.updatePlayerFeatureMatchState(eventId, matchId, player, { cardsKept }).then(settleCommandResult),
		);
	}

	/**
	 * The match-level Show-sideboards toggle: one atomic save revealing or hiding
	 * both players. The model stays per-player underneath (#490), so this decomposes
	 * into a Batch of two SetSideboardRevealed commands at the client seam.
	 */
	function setSideboardRevealed(eventId: number, matchId: number, revealed: boolean) {
		return optimistic.run(
			`sideboards:${matchId}`,
			matchId,
			current => ({
				...current,
				player1: { ...current.player1, sideboardRevealed: revealed },
				player2: { ...current.player2, sideboardRevealed: revealed },
			}),
			() => repo.updateState(eventId, matchId, {
				player1: { sideboardRevealed: revealed },
				player2: { sideboardRevealed: revealed },
			}).then(settleCommandResult),
		);
	}

	function setTurnNumber(eventId: number, matchId: number, turnNumber: number) {
		return optimistic.run(
			`turnNumber:${matchId}`,
			matchId,
			current => ({ ...current, turnNumber }),
			() => repo.updateState(eventId, matchId, { turnNumber }).then(settleCommandResult),
			// The server treats an explicit turn number as owning the field even
			// when it matches the current value.
			{
				serverOwns: ['turnNumber'],
			},
		);
	}

	function selectFirstPlayer(eventId: number, matchId: number, player: Seat) {
		return optimistic.run(
			`firstPlayer:${matchId}`,
			matchId,
			current => ({
				...current,
				firstPlayer: player,
				activePlayer: player,
				turnNumber: 1,
			}),
			() => repo.updateState(eventId, matchId, { firstPlayer: player, activePlayer: player, turnNumber: 1 }).then(settleCommandResult),
			{
				serverOwns: ['firstPlayer', 'activePlayer', 'turnNumber'],
			},
		);
	}

	function changeFirstPlayer(eventId: number, matchId: number) {
		const firstPlayer = pairSeatOf(featureMatchStates.value.get(matchId)?.firstPlayer);
		if (!firstPlayer)
			return null;

		const newFirstPlayer = otherFeatureMatchPlayer(firstPlayer);

		return optimistic.run(
			`firstPlayer:${matchId}`,
			matchId,
			state => ({ ...state, firstPlayer: newFirstPlayer }),
			() => repo.updateState(eventId, matchId, { firstPlayer: newFirstPlayer }).then(settleCommandResult),
		);
	}

	/**
	 * One turn step, as the Session's reducer takes it (used for optimistic
	 * updates): a half-turn of the pair, or the next Seat of a Commander game.
	 */
	function computeTurnStep(matchId: number, state: FeatureMatchState, delta: 1 | -1): FeatureMatchState {
		const snapshot = heldSession(matchId)?.sourceSnapshot;
		return snapshot && isCommanderSession(snapshot)
			? applyCommanderTurnStep(state, snapshot, delta)
			: applyFeatureMatchTurnStep(state, delta);
	}

	function stepTurn(eventId: number, matchId: number, delta: 1 | -1) {
		const current = featureMatchStates.value.get(matchId);
		if (!current?.activePlayer || !current.firstPlayer)
			return;

		// Boundary check: can't step back at turn 1 with first player active
		if (delta === -1 && current.activePlayer === current.firstPlayer && current.turnNumber <= 1)
			return;
		// A Commander game's turn answers itself where it cannot move: back at its
		// first turn, or on with no Seat left to take it. The pair's never does.
		if (computeTurnStep(matchId, current, delta) === current)
			return;

		turnBatch.enqueue(
			`${matchId}`,
			matchId,
			current => computeTurnStep(matchId, current, delta),
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
			() => repo.updateState(eventId, matchId, { activePlayer: player }).then(settleCommandResult),
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
			() => repo.recordGameWin(eventId, matchId, player, options).then(settleCommandResult),
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
			() => repo.undoGameWin(eventId, matchId, player, options).then(settleCommandResult),
		);
	}

	function resetMatch(eventId: number, matchId: number, options: FeatureMatchResetOptions) {
		return withServerUpdate(
			matchId,
			() => repo.resetMatch(eventId, matchId, options).then(settleCommandResult),
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
			() => repo.startOvertime(eventId, matchId, totalTurns).then(settleCommandResult),
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
				const activePlayer = pairSeatOf(current.activePlayer);
				const firstPlayer = pairSeatOf(current.firstPlayer);
				const swappedActive = activePlayer
					? otherFeatureMatchPlayer(activePlayer)
					: current.activePlayer;
				const swappedFirst = firstPlayer
					? otherFeatureMatchPlayer(firstPlayer)
					: current.firstPlayer;
				return {
					...current,
					player1: current.player2,
					player2: current.player1,
					activePlayer: swappedActive,
					firstPlayer: swappedFirst,
				};
			},
			() => repo.swapPlayers(eventId, matchId).then(settleCommandResult),
		);
	}

	// ──────────────── Realtime Handlers ────────────────

	async function applyRemoteSessionEvent(data: MessageData<'featureMatchSession:eventApplied'>) {
		if (follower.notify(data.slotId, data) === 'reload')
			await loadState(data.eventId, data.slotId);
	}

	// ──────────────── Reset ────────────────

	function $reset() {
		// Clear all batch state
		playerBatch.reset();
		clockAdjustBatch.reset();
		turnBatch.reset();
		bulkAdjustBatch.reset();
		optimistic.reset();
		follower.reset();

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
		readSessionsAsScreenOutput,
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
		adjustCommanderDamage,
		setEliminated,
		setOutcome,
		setCardsKept,
		setSideboardRevealed,
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
		cacheSession,
		offerSlotSession,
		settleSlotCommandResult,
		applyRemoteSessionEvent,
		$reset,
	};
});
