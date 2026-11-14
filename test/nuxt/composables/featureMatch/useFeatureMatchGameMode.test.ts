import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';

/** Server time runs this far ahead of the device's clock. */
const SERVER_AHEAD_MS = 5000;

const mockFeatureMatchStateStore = {
	updateState: vi.fn(),
	startOvertime: vi.fn(),
	stepTurn: vi.fn(),
	setTurnNumber: vi.fn(),
	resetMatch: vi.fn(),
};

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(() => ({
			result: Promise.resolve(false),
		})),
	})),
};

const mockToast = {
	add: vi.fn(),
};

const trackingEverything = {
	featureMatchDefaultTurnTrackingEnabled: true,
	featureMatchDefaultActivePlayerTrackingEnabled: true,
	featureMatchDefaultExtraTurnsEnabled: true,
	featureMatchDefaultMulliganTrackingEnabled: true,
	featureMatchDefaultExtraTurns: 5,
	featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
};

const mockEventData = ref(createMockEvent(trackingEverything));

mockNuxtImport('useEventStore', () => () => ({
	eventId: 1,
	event: mockEventData.value,
	displayEvent: mockEventData.value,
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime(() => ({
	getServerTime: () => Date.now() + SERVER_AHEAD_MS,
})));

function countdown(elapsedMs: number) {
	return {
		type: 'countdown' as const,
		durationMs: 60000,
		elapsedMs,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
	};
}

describe('useFeatureMatchGameMode', () => {
	beforeEach(() => {
		mockEventData.value = createMockEvent(trackingEverything);
	});

	function track(overrides: Record<string, boolean>) {
		mockEventData.value = createMockEvent({
			...trackingEverything,
			...overrides,
		});
	}

	function createSetup(stateOverrides: Partial<FeatureMatchState> | null = {}) {
		const state = stateOverrides && createMockFeatureMatchState({
			turnNumber: 1,
			firstPlayer: 'player1',
			activePlayer: 'player1',
			...stateOverrides,
		});
		return useFeatureMatchGameMode(10, computed(() => state));
	}

	describe('the mulligan phase', () => {
		it.each([
			[
				'before turn 1',
				{},
				{ turnNumber: 0, firstPlayer: null, activePlayer: null },
				true,
			],
			[
				'from turn 1',
				{},
				{ turnNumber: 1 },
				false,
			],
			[
				'without a Session state',
				{},
				null,
				false,
			],
			[
				'with mulligan tracking off',
				{ featureMatchDefaultMulliganTrackingEnabled: false },
				{ turnNumber: 0 },
				false,
			],
			[
				'with turn and active-player tracking off',
				{ featureMatchDefaultTurnTrackingEnabled: false, featureMatchDefaultActivePlayerTrackingEnabled: false },
				{ turnNumber: 0 },
				false,
			],
		] as const)('is %s: %#', (_, tracking, state, expected) => {
			track(tracking);

			expect(createSetup(state as Partial<FeatureMatchState> | null).inMulliganPhase.value).toBe(expected);
		});
	});

	describe('the turn counter', () => {
		it.each([
			[
				'asks for a first player while none is chosen',
				{},
				{ firstPlayer: null },
				'selection',
			],
			[
				'counts once a first player is chosen',
				{},
				{ firstPlayer: 'player1' },
				'counter',
			],
			[
				'counts without active-player tracking',
				{ featureMatchDefaultActivePlayerTrackingEnabled: false },
				{ firstPlayer: null },
				'counter',
			],
		] as const)('%s', (_, tracking, state, expected) => {
			track(tracking);

			expect(createSetup(state).turnCounterMode.value).toBe(expected);
		});

		it.each([
			[
				'with a Session and tracking',
				{},
				{},
				true,
			],
			[
				'without a Session state',
				{},
				null,
				false,
			],
			[
				'with turn and active-player tracking off',
				{ featureMatchDefaultTurnTrackingEnabled: false, featureMatchDefaultActivePlayerTrackingEnabled: false },
				{},
				false,
			],
		] as const)('shows %s: %#', (_, tracking, state, expected) => {
			track(tracking);

			expect(!!createSetup(state as Partial<FeatureMatchState> | null).showTurnCounter.value).toBe(expected);
		});

		it.each([
			['the turn number with turn tracking', {}, 'Turn 3'],
			[
				'"Active" with active-player tracking only',
				{ featureMatchDefaultTurnTrackingEnabled: false },
				'Active',
			],
		])('labels itself with %s', (_, tracking, expected) => {
			track(tracking);

			expect(createSetup({ turnNumber: 3 }).turnCounterLabel.value).toBe(expected);
		});

		it.each([
			[
				'the first half of turn 1',
				{ activePlayer: 'player1', turnNumber: 1 },
				true,
				1,
			],
			[
				'the second half of turn 1',
				{ activePlayer: 'player2', turnNumber: 1 },
				false,
				2,
			],
			[
				'a later turn',
				{ activePlayer: 'player1', turnNumber: 2 },
				false,
				1,
			],
		] as const)('steps back from %s only when there is somewhere to go', (_, state, disabled, half) => {
			const mode = createSetup({ firstPlayer: 'player1', ...state });

			expect(mode.stepBackDisabled.value).toBe(disabled);
			expect(mode.turnHalf.value).toBe(half);
		});

		it.each([
			[
				'no first player',
				{ firstPlayer: null, activePlayer: null },
			],
			[
				'no active player',
				{ firstPlayer: 'player1', activePlayer: null },
			],
		] as const)('cannot step back with %s', (_, state) => {
			expect(createSetup(state).stepBackDisabled.value).toBe(true);
		});
	});

	describe('turn changes', () => {
		it('steps the turn when active-player tracking is on', async () => {
			await createSetup().handleTurnChange(1);

			expect(mockFeatureMatchStateStore.stepTurn).toHaveBeenCalledWith(1, 10, 1);
			expect(mockFeatureMatchStateStore.setTurnNumber).not.toHaveBeenCalled();
		});

		it.each([
			['counts the turn number on', 3, 1, 4],
			['never counts below turn 0', 0, -1, 0],
		])('%s without active-player tracking', async (_, turnNumber, delta, expected) => {
			track({ featureMatchDefaultActivePlayerTrackingEnabled: false });

			await createSetup({ turnNumber, firstPlayer: null, activePlayer: null }).handleTurnChange(delta);

			expect(mockFeatureMatchStateStore.setTurnNumber).toHaveBeenCalledWith(1, 10, expected);
		});
	});

	describe('the clock', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		// When a countdown runs out is its projection's rule; this reads it on server time, as it changes.
		it('expires as a running countdown reaches its end by server time, not the device\'s', async () => {
			vi.useFakeTimers({ now: 1_000_000 });
			const mode = createSetup({
				clock: {
					...countdown(0),
					isRunning: true,
					lastStartedAt: 1_000_000,
				},
			});

			await vi.advanceTimersByTimeAsync(60_000 - SERVER_AHEAD_MS - 1);
			expect(mode.isClockExpired.value).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			expect(mode.isClockExpired.value).toBe(true);
		});

		it('starts overtime with the Event\'s extra turns when the countdown runs out', async () => {
			const state = shallowRef(createMockFeatureMatchState({
				clock: countdown(0),
			}));
			useFeatureMatchGameMode(10, computed(() => state.value as FeatureMatchState));

			state.value = createMockFeatureMatchState({
				clock: countdown(60001),
			});
			await nextTick();

			expect(mockFeatureMatchStateStore.startOvertime).toHaveBeenCalledWith(1, 10, 5);
		});
	});

	// The One Piece Card Game tracks the clock, game wins, turns and players only, whatever the Event's toggles say.
	describe('the match state a Card Game tracks', () => {
		it.each([
			['mtg', true],
			['op', false],
		] as const)('on a %s Event, tracks life, mulligans, counters, overtime and sideboards: %s', async (game, tracked) => {
			mockEventData.value = createMockEvent({ ...trackingEverything, game });
			const state = shallowRef(createMockFeatureMatchState({
				turnNumber: 0,
				clock: countdown(0),
			}));
			const mode = useFeatureMatchGameMode(10, computed(() => state.value as FeatureMatchState));

			expect({
				life: mode.lifeTrackingEnabled.value,
				mulligan: mode.inMulliganPhase.value,
				counters: mode.counterTrackingEnabled.value,
				overtime: mode.overtimeTrackingEnabled.value,
				sideboard: mode.sideboardTrackingEnabled.value,
			}).toEqual({
				life: tracked,
				mulligan: tracked,
				counters: tracked,
				overtime: tracked,
				sideboard: tracked,
			});

			state.value = createMockFeatureMatchState({
				turnNumber: 0,
				clock: countdown(60001),
			});
			await nextTick();
			expect(mockFeatureMatchStateStore.startOvertime.mock.calls.length > 0).toBe(tracked);
		});

		it.each([
			['mtg', 7],
			['op', 5],
		] as const)('deals a %s opening hand of %i', (game, handSize) => {
			mockEventData.value = createMockEvent({ ...trackingEverything, game });

			expect(createSetup().startingHandSize.value).toBe(handSize);
		});
	});

	describe('resetting a game', () => {
		it('resets the game once the operator confirms', async () => {
			mockOverlay.create.mockReturnValueOnce({
				open: vi.fn(() => ({
					result: Promise.resolve(true),
				})),
			});

			await createSetup().handleResetGame();

			expect(mockFeatureMatchStateStore.resetMatch).toHaveBeenCalledWith(1, 10, { type: 'game' });
		});

		it('leaves the game alone when the operator cancels', async () => {
			await createSetup().handleResetGame();

			expect(mockFeatureMatchStateStore.resetMatch).not.toHaveBeenCalled();
		});
	});

	// A Commander Session's game is its whole Session, driven from its Seats' own controls (ADR-0087).
	describe('on a Commander Event', () => {
		beforeEach(() => {
			mockEventData.value = createMockEvent({ ...trackingEverything, variant: 'commander' });
		});

		it('offers a game reset alone, no dialog editing the pair, and no half of a turn', () => {
			const mode = createSetup();

			expect(mode.resetActionItems.value.flat().map(item => item.label)).toEqual(['Reset Game']);
			expect(mode.matchActionItems.value).toEqual([]);
			expect(mode.turnHalf.value).toBeUndefined();
		});

		it('tracks no overtime and no Sideboard, whatever the Event says', () => {
			const mode = createSetup();

			expect([mode.overtimeTrackingEnabled.value, mode.sideboardTrackingEnabled.value, mode.extraTurnsEnabled.value]).toEqual([false, false, false]);
			expect([mode.lifeTrackingEnabled.value, mode.counterTrackingEnabled.value, mode.mulliganTrackingEnabled.value]).toEqual([true, true, true]);
		});
	});

	describe('match actions', () => {
		it('always offers Edit Match State, and Change First Player once one is chosen', () => {
			const labels = (state: Partial<FeatureMatchState>) => createSetup(state).matchActionItems.value[0]!.map(a => a.label);

			expect(labels({ firstPlayer: null })).toEqual(['Edit Match State…']);
			expect(labels({ firstPlayer: 'player1' })).toContain('Change First Player');
		});

		it('opens the edit-state modal from its action item', () => {
			const mode = createSetup();

			const editItem = mode.matchActionItems.value[0]!.find(a => a.label === 'Edit Match State…')!;
			(editItem.onSelect as () => void)();

			expect(mode.editStateOpen.value).toBe(true);
		});

		it('routes the whole edit through one updateState call and closes on success', async () => {
			mockFeatureMatchStateStore.updateState.mockResolvedValue(createMockFeatureMatchState());
			const mode = createSetup();
			mode.editStateOpen.value = true;

			await mode.handleEditStateSave({
				turnNumber: 7,
				player1: { lifeTotal: 12 },
			});

			expect(mockFeatureMatchStateStore.updateState).toHaveBeenCalledExactlyOnceWith(1, 10, {
				turnNumber: 7,
				player1: { lifeTotal: 12 },
			});
			expect(mode.editStateOpen.value).toBe(false);
		});

		it('keeps the modal open and says why when the save is refused, so the edit is not lost', async () => {
			mockFeatureMatchStateStore.updateState.mockResolvedValue(null);
			const mode = createSetup();
			mode.editStateOpen.value = true;

			await mode.handleEditStateSave({ turnNumber: 7 });

			expect(mode.editStateOpen.value).toBe(true);
			expect(mockToast.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				title: 'Failed to update match state',
				color: 'error',
			}));
		});
	});
});
