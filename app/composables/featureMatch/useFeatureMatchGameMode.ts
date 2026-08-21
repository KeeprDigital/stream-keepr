import type { MaybeRefOrGetter } from 'vue';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchStateUpdate } from '~/modules/feature-match-session/client';
import { useIntervalFn } from '@vueuse/core';
import { getStartingHandSize } from '~~/shared/config/games';
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
	const confirmModal = overlay.create(LazyUIConfirmActionModal);

	const mid = () => toValue(matchId);
	const eid = () => eventStore.eventId;

	const game = computed(() => (eventStore.event?.game ?? 'mtg'));
	const defaults = computed(() => toFeatureMatchDefaults(eventStore.event));

	// ── Feature flags from event config ──

	const turnTrackingEnabled = computed(() => defaults.value.turnTrackingEnabled);
	const activePlayerTrackingEnabled = computed(() => defaults.value.activePlayerTrackingEnabled);
	const extraTurnsEnabled = computed(() => defaults.value.extraTurnsEnabled);
	const mulliganTrackingEnabled = computed(() => defaults.value.mulliganTrackingEnabled);

	// Display feature flags (event-level toggles for optional fields)
	const pronounsEnabled = computed(() => eventStore.event?.pronounsEnabled ?? true);
	const standingsEnabled = computed(() => eventStore.event?.standingsEnabled ?? true);
	const lgsEnabled = computed(() => eventStore.event?.lgsEnabled ?? false);
	const tableNumberEnabled = computed(() => eventStore.event?.tableNumberEnabled ?? false);

	// ── Mulligan phase ──

	const inMulliganPhase = computed(() =>
		mulliganTrackingEnabled.value
		&& (turnTrackingEnabled.value || activePlayerTrackingEnabled.value)
		&& matchState.value != null
		&& matchState.value.turnNumber < 1,
	);

	const startingHandSize = computed(() => {
		return game.value ? getStartingHandSize(game.value) : 7;
	});

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
		if (!matchState.value?.firstPlayer || !matchState.value.activePlayer)
			return true;
		return matchState.value.activePlayer === matchState.value.firstPlayer && matchState.value.turnNumber <= 1;
	});

	const turnHalf = computed<1 | 2 | undefined>(() => {
		if (!activePlayerTrackingEnabled.value || !matchState.value?.activePlayer || !matchState.value.firstPlayer)
			return undefined;
		return matchState.value.activePlayer === matchState.value.firstPlayer ? 1 : 2;
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
		if (state.player1.cardsKept === undefined) {
			await featureMatchStateStore.setCardsKept(eid()!, mid(), 'player1', startingHandSize.value);
		}
		if (state.player2.cardsKept === undefined) {
			await featureMatchStateStore.setCardsKept(eid()!, mid(), 'player2', startingHandSize.value);
		}
	}

	async function handleCardsKeptUpdate(player: PlayerSide, value: number) {
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

	async function handleSelectFirstPlayer(player: PlayerSide) {
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
			message: 'Reset life totals, counters, and turn tracking for the current game?',
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
	 * save that landed, and a refused one keeps the operator's edit on screen.
	 */
	async function handleEditStateSave(update: FeatureMatchStateUpdate) {
		if (!eid())
			return;
		editStateSaving.value = true;
		try {
			const result = await featureMatchStateStore.updateState(eid()!, mid(), update);
			if (result)
				editStateOpen.value = false;
		}
		finally {
			editStateSaving.value = false;
		}
	}

	// ── Action items ──

	const matchActionItems = computed(() => {
		const items: import('@nuxt/ui').DropdownMenuItem[][] = [];
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

	const resetActionItems = computed<import('@nuxt/ui').DropdownMenuItem[][]>(() => [[
		{
			label: 'Reset Game',
			icon: 'i-lucide-refresh-cw',
			onSelect: handleResetGame,
		},
		{
			label: 'Reset Match',
			icon: 'i-lucide-rotate-ccw',
			color: 'error',
			onSelect: handleResetMatch,
		},
	]]);

	return {
		// Feature flags
		turnTrackingEnabled,
		activePlayerTrackingEnabled,
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
