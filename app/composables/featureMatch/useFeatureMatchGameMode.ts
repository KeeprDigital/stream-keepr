import type { MaybeRefOrGetter } from 'vue';
import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchStateUpdate } from '~/modules/feature-match-session/client';
import { useIntervalFn } from '@vueuse/core';
import { eventKind, getFeatureMatchStateTracking, getStartingHandSize } from '~~/shared/config/games';
import { applyCommanderTurnStep, filledSeats } from '~~/shared/modules/feature-match-session';
import { PLAYER_SIDE_VALUES } from '~~/shared/types/enums';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { getEffectiveElapsedMs } from '~~/shared/utils/clock';
import { LazyUIConfirmActionModal } from '#components';

/**
 * Composable that encapsulates all match game-mode logic:
 * turn tracking, active player, mulligan phase, clock expiration,
 * overtime auto-start, and game/match action handlers.
 */
export function useFeatureMatchGameMode(
	matchId: MaybeRefOrGetter<number>,
	matchState: ComputedRef<FeatureMatchState | null>,
) {
	const eventStore = useEventStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const overlay = useOverlay();
	const toast = useToast();
	const confirmModal = overlay.create(LazyUIConfirmActionModal);

	const mid = () => toValue(matchId);
	const eid = () => eventStore.eventId;

	const game = computed(() => (eventStore.displayEvent?.game ?? 'mtg'));
	const defaults = computed(() => toFeatureMatchDefaults(eventStore.displayEvent));

	// ── Feature flags from the Card Game and event config ──

	// What the Event tracks, by its Card Game and Variant, bounds what its toggles can turn on.
	const kind = computed(() => eventKind({ game: game.value, variant: eventStore.displayEvent?.variant }));
	const tracks = computed(() => getFeatureMatchStateTracking(kind.value));
	/** A Commander Event's Session plays one game across up to four Seats (ADR-0087). */
	const isCommander = computed(() => kind.value === 'mtg-commander');

	/** The Seats in the game: the pair, or a Commander Slot's filled Seats. */
	const seatsInGame = computed<readonly Seat[]>(() => {
		if (!isCommander.value)
			return PLAYER_SIDE_VALUES;
		const session = followedFeatureMatchSession(mid(), featureMatchStateStore);
		return session
			? filledSeats(session.sourceSnapshot)
			: [];
	});

	const turnTrackingEnabled = computed(() => defaults.value.turnTrackingEnabled);
	const activePlayerTrackingEnabled = computed(() => defaults.value.activePlayerTrackingEnabled);
	const lifeTrackingEnabled = computed(() => tracks.value.life);
	const counterTrackingEnabled = computed(() => tracks.value.counters);
	const overtimeTrackingEnabled = computed(() => tracks.value.overtime);
	const sideboardTrackingEnabled = computed(() => tracks.value.sideboard);
	const extraTurnsEnabled = computed(() => tracks.value.overtime && defaults.value.extraTurnsEnabled);
	const mulliganTrackingEnabled = computed(() => tracks.value.mulligan && defaults.value.mulliganTrackingEnabled);

	// Display feature flags (event-level toggles for optional fields)
	const pronounsEnabled = computed(() => eventStore.displayEvent?.pronounsEnabled ?? true);
	const standingsEnabled = computed(() => eventStore.displayEvent?.standingsEnabled ?? true);
	const lgsEnabled = computed(() => eventStore.displayEvent?.lgsEnabled ?? false);
	const tableNumberEnabled = computed(() => eventStore.displayEvent?.tableNumberEnabled ?? false);

	// ── Mulligan phase ──

	const inMulliganPhase = computed(() =>
		mulliganTrackingEnabled.value
		&& (turnTrackingEnabled.value || activePlayerTrackingEnabled.value)
		&& matchState.value != null
		&& matchState.value.turnNumber < 1,
	);

	const startingHandSize = computed(() => getStartingHandSize(game.value));

	// ── Turn counter ──

	const needsFirstPlayerSelection = computed(() =>
		activePlayerTrackingEnabled.value && matchState.value && !matchState.value.firstPlayer,
	);

	const turnCounterMode = computed<'counter' | 'selection'>(() =>
		needsFirstPlayerSelection.value ? 'selection' : 'counter',
	);

	const showTurnCounter = computed(() =>
		(turnTrackingEnabled.value || activePlayerTrackingEnabled.value) && matchState.value,
	);

	const turnCounterLabel = computed(() => {
		if (needsFirstPlayerSelection.value)
			return undefined;
		if (turnTrackingEnabled.value)
			return `Turn ${matchState.value?.turnNumber ?? 0}`;
		return 'Active';
	});

	const stepBackDisabled = computed(() => {
		const state = matchState.value;
		if (!state?.firstPlayer || !state.activePlayer)
			return true;
		// A Commander game's first turn may start past the Seat that went first, once that Seat is out.
		const snapshot = isCommander.value && followedFeatureMatchSession(mid(), featureMatchStateStore)?.sourceSnapshot;
		if (snapshot)
			return applyCommanderTurnStep(state, snapshot, -1) === state;
		return state.activePlayer === state.firstPlayer && state.turnNumber <= 1;
	});

	const turnHalf = computed<1 | 2 | undefined>(() => {
		// A Commander game's turn passes round the table, not back and forth.
		if (isCommander.value || !activePlayerTrackingEnabled.value || !matchState.value?.activePlayer || !matchState.value.firstPlayer)
			return undefined;
		return matchState.value.activePlayer === matchState.value.firstPlayer
			? 1
			: 2;
	});

	const extraTurnsTotal = computed(() => defaults.value.extraTurns);
	const extraTurnsLabel = computed(() => defaults.value.extraTurnsLabel);

	// ── Clock expiration ──

	const clockTick = ref(0);
	const { pause: pauseClockTick, resume: resumeClockTick } = useIntervalFn(
		() => { clockTick.value++; },
		1000,
		{ immediate: false },
	);

	watch(
		() => matchState.value?.clock.isRunning,
		(isRunning) => {
			if (isRunning)
				resumeClockTick();
			else
				pauseClockTick();
		},
		{ immediate: true },
	);

	const isClockExpired = computed(() => {
		if (!matchState.value || matchState.value.clock.type !== 'countdown')
			return false;
		if (matchState.value.clock.isRunning)
			void clockTick.value;
		const elapsed = getEffectiveElapsedMs(matchState.value.clock, Date.now());
		return elapsed >= matchState.value.clock.durationMs;
	});

	// ── Auto-start overtime ──

	watch(isClockExpired, (expired) => {
		if (expired && extraTurnsEnabled.value && !matchState.value?.overtime) {
			if (!eid())
				return;
			void featureMatchStateStore.startOvertime(eid()!, mid(), extraTurnsTotal.value);
		}
	});

	// ── Action handlers ──

	async function autoCommitCardsKept() {
		if (!eid() || !matchState.value)
			return;
		const state = matchState.value;
		for (const seat of seatsInGame.value) {
			if (state[seat] && state[seat].cardsKept === undefined)
				await featureMatchStateStore.setCardsKept(eid()!, mid(), seat, startingHandSize.value);
		}
	}

	async function handleCardsKeptUpdate(player: Seat, value: number) {
		if (!eid())
			return;
		await featureMatchStateStore.setCardsKept(eid()!, mid(), player, value);
	}

	async function handleTurnChange(delta: number) {
		if (!eid() || !matchState.value)
			return;

		if (inMulliganPhase.value && delta === 1) {
			await autoCommitCardsKept();
		}

		if (activePlayerTrackingEnabled.value && matchState.value.firstPlayer) {
			await featureMatchStateStore.stepTurn(eid()!, mid(), delta as 1 | -1);
		}
		else {
			const newTurn = Math.max(0, matchState.value.turnNumber + delta);
			await featureMatchStateStore.setTurnNumber(eid()!, mid(), newTurn);
		}
	}

	async function handleSelectFirstPlayer(player: Seat) {
		if (!eid())
			return;
		if (inMulliganPhase.value) {
			await autoCommitCardsKept();
		}
		await featureMatchStateStore.selectFirstPlayer(eid()!, mid(), player);
	}

	async function handleChangeFirstPlayer() {
		if (!eid())
			return;
		await featureMatchStateStore.changeFirstPlayer(eid()!, mid());
	}

	async function handleNextOvertimeTurn() {
		if (!eid())
			return;
		await featureMatchStateStore.nextOvertimeTurn(eid()!, mid());
	}

	async function handlePrevOvertimeTurn() {
		if (!eid())
			return;
		await featureMatchStateStore.prevOvertimeTurn(eid()!, mid());
	}

	async function handleResetGame() {
		if (!eid())
			return;

		const instance = confirmModal.open({
			title: 'Reset Game',
			message: isCommander.value
				? 'Start a new game with the same players? Life, Commander Damage, counters, Eliminated Seats, the turn, the outcome and the clock all reset.'
				: 'Reset life totals, counters, and turn tracking for the current game?',
			icon: 'i-lucide-refresh-cw',
			confirmLabel: 'Reset Game',
			confirmColor: 'warning',
		});

		const confirmed = await instance.result;
		if (confirmed) {
			await featureMatchStateStore.resetMatch(eid()!, mid(), { type: 'game' });
		}
	}

	async function handleResetMatch() {
		if (!eid())
			return;

		const instance = confirmModal.open({
			title: 'Reset Match',
			message: 'Reset all game wins, life totals, counters, and turn tracking for the entire match?',
			description: 'This action cannot be undone.',
			icon: 'i-lucide-rotate-ccw',
			iconColor: 'text-error',
			confirmLabel: 'Reset Match',
			confirmColor: 'error',
		});

		const confirmed = await instance.result;
		if (confirmed) {
			await featureMatchStateStore.resetMatch(eid()!, mid(), { type: 'match' });
		}
	}

	// ── Edit state dialog ──

	const editStateOpen = ref(false);
	const editStateSaving = ref(false);

	/**
	 * One dialog save is one store call: the whole diff goes through
	 * `updateState`, which sends it as a single atomic command and rolls the
	 * whole prediction back if it is refused — so the modal closes only on a
	 * save that landed, and a refused one keeps the operator's edit on screen
	 * and says why it was refused.
	 */
	async function handleEditStateSave(update: FeatureMatchStateUpdate) {
		if (!eid())
			return;
		editStateSaving.value = true;
		try {
			const result = await featureMatchStateStore.updateState(eid()!, mid(), update);
			if (result) {
				editStateOpen.value = false;
			}
			else {
				toast.add({
					title: 'Failed to update match state',
					description: featureMatchStateStore.error ?? undefined,
					color: 'error',
				});
			}
		}
		finally {
			editStateSaving.value = false;
		}
	}

	// ── Action items ──

	const matchActionItems = computed(() => {
		const items: import('@nuxt/ui').DropdownMenuItem[][] = [];
		// Its dialog and its first-player change edit the pair; a Commander
		// game's state is all on its Seats' own controls.
		if (isCommander.value)
			return items;
		const actions: import('@nuxt/ui').DropdownMenuItem[] = [
			{
				label: 'Edit Match State…',
				icon: 'i-lucide-pencil',
				onSelect: () => {
					editStateOpen.value = true;
				},
			},
		];

		if (activePlayerTrackingEnabled.value && matchState.value?.firstPlayer) {
			actions.push({
				label: 'Change First Player',
				icon: 'i-lucide-repeat-2',
				onSelect: handleChangeFirstPlayer,
			});
		}

		items.push(actions);
		return items;
	});

	const resetActionItems = computed<import('@nuxt/ui').DropdownMenuItem[][]>(() => [
		[
			{
				label: 'Reset Game',
				icon: 'i-lucide-refresh-cw',
				onSelect: handleResetGame,
			},
			// One game is the whole of a Commander Session: there is no match to reset apart from it.
			...(isCommander.value
				? []
				: [
						{
							label: 'Reset Match',
							icon: 'i-lucide-rotate-ccw',
							color: 'error' as const,
							onSelect: handleResetMatch,
						},
					]),
		],
	]);

	return {
		isCommander,
		needsFirstPlayerSelection,

		// Feature flags
		turnTrackingEnabled,
		activePlayerTrackingEnabled,
		lifeTrackingEnabled,
		counterTrackingEnabled,
		overtimeTrackingEnabled,
		sideboardTrackingEnabled,
		extraTurnsEnabled,
		mulliganTrackingEnabled,
		pronounsEnabled,
		standingsEnabled,
		lgsEnabled,
		tableNumberEnabled,

		// Mulligan
		inMulliganPhase,
		startingHandSize,

		// Turn counter
		turnCounterMode,
		showTurnCounter,
		turnCounterLabel,
		turnHalf,
		stepBackDisabled,

		// Overtime
		extraTurnsLabel,

		// Clock
		isClockExpired,

		// Action handlers
		handleCardsKeptUpdate,
		handleTurnChange,
		handleSelectFirstPlayer,
		handleNextOvertimeTurn,
		handlePrevOvertimeTurn,
		handleResetGame,

		// Edit state dialog
		editStateOpen,
		editStateSaving,
		handleEditStateSave,

		// Dropdown
		matchActionItems,
		resetActionItems,
	};
}
