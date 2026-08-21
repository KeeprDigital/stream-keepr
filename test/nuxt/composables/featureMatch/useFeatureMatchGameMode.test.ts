import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';

// Capture the real useIntervalFn before any mocks intercept it
const { useIntervalFn: realUseIntervalFn } = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core');

// ── Mock Dependencies ──

const mockFeatureMatchStateStore = {
	updateState: vi.fn(),
	startOvertime: vi.fn(),
	setCardsKept: vi.fn(),
	stepTurn: vi.fn(),
	setTurnNumber: vi.fn(),
	selectFirstPlayer: vi.fn(),
	changeFirstPlayer: vi.fn(),
	nextOvertimeTurn: vi.fn(),
	prevOvertimeTurn: vi.fn(),
	resetMatch: vi.fn(),
	swapPlayers: vi.fn(),
};

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(() => ({ result: Promise.resolve(false) })),
	})),
};

const mockToast = { add: vi.fn() };

const mockEventData = ref(createMockEvent({
	featureMatchDefaultTurnTrackingEnabled: true,
	featureMatchDefaultActivePlayerTrackingEnabled: true,
	featureMatchDefaultExtraTurnsEnabled: true,
	featureMatchDefaultMulliganTrackingEnabled: true,
	featureMatchDefaultExtraTurns: 5,
	featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
}));

mockNuxtImport('useEventStore', () => () => ({
	eventId: 1,
	event: mockEventData.value,
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('useToast', () => () => mockToast);

// Mock useIntervalFn to pass through to the real @vueuse/core implementation,
// bypassing the Nuxt auto-import proxy to avoid infinite recursion.
mockNuxtImport('useIntervalFn', () => (fn: any, interval: any, options?: any) => realUseIntervalFn(fn, interval, options));

describe('useFeatureMatchGameMode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventData.value = createMockEvent({
			featureMatchDefaultTurnTrackingEnabled: true,
			featureMatchDefaultActivePlayerTrackingEnabled: true,
			featureMatchDefaultExtraTurnsEnabled: true,
			featureMatchDefaultMulliganTrackingEnabled: true,
			featureMatchDefaultExtraTurns: 5,
			featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
		});
	});

	function createSetup(stateOverrides: Partial<FeatureMatchState> = {}) {
		const state = createMockFeatureMatchState({
			turnNumber: 1,
			firstPlayer: 'player1',
			activePlayer: 'player1',
			...stateOverrides,
		});
		const matchState = computed(() => state);
		return useFeatureMatchGameMode(10, matchState);
	}

	function createSetupWithNullState() {
		const matchState = computed(() => null);
		return useFeatureMatchGameMode(10, matchState);
	}

	// ── inMulliganPhase ──

	describe('inMulliganPhase', () => {
		it('is true when turnNumber < 1 and tracking enabled', () => {
			const mode = createSetup({ turnNumber: 0, firstPlayer: null, activePlayer: null });
			expect(mode.inMulliganPhase.value).toBe(true);
		});

		it('is false when turnNumber >= 1', () => {
			const mode = createSetup({ turnNumber: 1 });
			expect(mode.inMulliganPhase.value).toBe(false);
		});

		it('is false when matchState is null', () => {
			const mode = createSetupWithNullState();
			expect(mode.inMulliganPhase.value).toBe(false);
		});

		it('is false when mulligan tracking disabled', () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: true,
				featureMatchDefaultActivePlayerTrackingEnabled: true,
				featureMatchDefaultMulliganTrackingEnabled: false,
			});
			const mode = createSetup({ turnNumber: 0 });
			expect(mode.inMulliganPhase.value).toBe(false);
		});

		it('is false when both turn and active player tracking disabled', () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: false,
				featureMatchDefaultActivePlayerTrackingEnabled: false,
				featureMatchDefaultMulliganTrackingEnabled: true,
			});
			const mode = createSetup({ turnNumber: 0 });
			expect(mode.inMulliganPhase.value).toBe(false);
		});
	});

	// ── needsFirstPlayerSelection ──

	describe('needsFirstPlayerSelection', () => {
		it('is true when active tracking enabled but no firstPlayer', () => {
			const mode = createSetup({ firstPlayer: null });
			expect(mode.turnCounterMode.value).toBe('selection');
		});

		it('is false when firstPlayer is set', () => {
			const mode = createSetup({ firstPlayer: 'player1' });
			expect(mode.turnCounterMode.value).toBe('counter');
		});

		it('is false when active player tracking disabled', () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: true,
				featureMatchDefaultActivePlayerTrackingEnabled: false,
			});
			const mode = createSetup({ firstPlayer: null });
			expect(mode.turnCounterMode.value).toBe('counter');
		});
	});

	// ── turnCounterMode ──

	describe('turnCounterMode', () => {
		it('returns "selection" when no firstPlayer selected', () => {
			const mode = createSetup({ firstPlayer: null });
			expect(mode.turnCounterMode.value).toBe('selection');
		});

		it('returns "counter" when firstPlayer is set', () => {
			const mode = createSetup({ firstPlayer: 'player1' });
			expect(mode.turnCounterMode.value).toBe('counter');
		});
	});

	// ── showTurnCounter ──

	describe('showTurnCounter', () => {
		it('is truthy when turn tracking enabled and state exists', () => {
			const mode = createSetup();
			expect(!!mode.showTurnCounter.value).toBe(true);
		});

		it('is falsy when state is null', () => {
			const mode = createSetupWithNullState();
			expect(!!mode.showTurnCounter.value).toBe(false);
		});

		it('is falsy when both turn and active tracking disabled', () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: false,
				featureMatchDefaultActivePlayerTrackingEnabled: false,
			});
			const mode = createSetup();
			expect(!!mode.showTurnCounter.value).toBe(false);
		});
	});

	// ── turnCounterLabel ──

	describe('turnCounterLabel', () => {
		it('returns "Turn N" when turn tracking enabled', () => {
			const mode = createSetup({ turnNumber: 3, firstPlayer: 'player1' });
			expect(mode.turnCounterLabel.value).toBe('Turn 3');
		});

		it('returns "Active" when only active tracking enabled', () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: false,
				featureMatchDefaultActivePlayerTrackingEnabled: true,
			});
			const mode = createSetup({ firstPlayer: 'player1' });
			expect(mode.turnCounterLabel.value).toBe('Active');
		});
	});

	// ── stepBackDisabled ──

	describe('stepBackDisabled', () => {
		it('is true when at turn 1 and active equals first player', () => {
			const mode = createSetup({ firstPlayer: 'player1', activePlayer: 'player1', turnNumber: 1 });
			expect(mode.stepBackDisabled.value).toBe(true);
		});

		it('is false when activePlayer differs from firstPlayer (second half of turn)', () => {
			const mode = createSetup({ firstPlayer: 'player1', activePlayer: 'player2', turnNumber: 1 });
			expect(mode.stepBackDisabled.value).toBe(false);
		});

		it('is false on turn > 1', () => {
			const mode = createSetup({ firstPlayer: 'player1', activePlayer: 'player1', turnNumber: 2 });
			expect(mode.stepBackDisabled.value).toBe(false);
		});

		it('is true when no firstPlayer', () => {
			const mode = createSetup({ firstPlayer: null, activePlayer: null });
			expect(mode.stepBackDisabled.value).toBe(true);
		});

		it('is true when no activePlayer', () => {
			const mode = createSetup({ firstPlayer: 'player1', activePlayer: null });
			expect(mode.stepBackDisabled.value).toBe(true);
		});
	});

	// ── turnHalf ──

	describe('turnHalf', () => {
		it('returns 1 when activePlayer equals firstPlayer', () => {
			const mode = createSetup({ firstPlayer: 'player1', activePlayer: 'player1' });
			expect(mode.turnHalf.value).toBe(1);
		});

		it('returns 2 when activePlayer differs from firstPlayer', () => {
			const mode = createSetup({ firstPlayer: 'player1', activePlayer: 'player2' });
			expect(mode.turnHalf.value).toBe(2);
		});
	});

	// ── isClockExpired ──

	describe('isClockExpired', () => {
		it('returns false for non-countdown clocks', () => {
			const mode = createSetup({
				clock: {
					type: 'countup',
					durationMs: 0,
					elapsedMs: 5000,
					isRunning: false,
					lastStartedAt: null,
					countUpAfterCountdown: false,
				},
			});
			expect(mode.isClockExpired.value).toBe(false);
		});

		it('returns false when countdown has not expired', () => {
			const mode = createSetup({
				clock: {
					type: 'countdown',
					durationMs: 60000,
					elapsedMs: 30000,
					isRunning: false,
					lastStartedAt: null,
					countUpAfterCountdown: false,
				},
			});
			expect(mode.isClockExpired.value).toBe(false);
		});

		it('returns true when countdown elapsed >= duration', () => {
			const mode = createSetup({
				clock: {
					type: 'countdown',
					durationMs: 60000,
					elapsedMs: 60000,
					isRunning: false,
					lastStartedAt: null,
					countUpAfterCountdown: false,
				},
			});
			expect(mode.isClockExpired.value).toBe(true);
		});

		it('returns false when matchState is null', () => {
			const mode = createSetupWithNullState();
			expect(mode.isClockExpired.value).toBe(false);
		});
	});

	// ── Feature flags ──

	describe('feature flags', () => {
		it('reports feature flags from event config', () => {
			const mode = createSetup();
			expect(mode.activePlayerTrackingEnabled.value).toBe(true);
			expect(mode.extraTurnsEnabled.value).toBe(true);
		});

		it('reports display flags from event', () => {
			mockEventData.value = createMockEvent({
				pronounsEnabled: false,
				standingsEnabled: false,
				lgsEnabled: true,
				tableNumberEnabled: true,
			});
			const mode = createSetup();
			expect(mode.pronounsEnabled.value).toBe(false);
			expect(mode.standingsEnabled.value).toBe(false);
			expect(mode.lgsEnabled.value).toBe(true);
			expect(mode.tableNumberEnabled.value).toBe(true);
		});

		it('returns extraTurnsLabel from defaults', () => {
			const mode = createSetup();
			expect(mode.extraTurnsLabel.value).toBe('Extra Turns');
		});
	});

	// ── Action handlers (delegation) ──

	describe('handleTurnChange', () => {
		it('delegates to stepTurn when active player tracking is on', async () => {
			const mode = createSetup();
			await mode.handleTurnChange(1);
			expect(mockFeatureMatchStateStore.stepTurn).toHaveBeenCalledWith(1, 10, 1);
		});

		it('delegates to setTurnNumber when no firstPlayer', async () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: true,
				featureMatchDefaultActivePlayerTrackingEnabled: false,
			});
			const mode = createSetup({ turnNumber: 3, firstPlayer: null, activePlayer: null });
			await mode.handleTurnChange(1);
			expect(mockFeatureMatchStateStore.setTurnNumber).toHaveBeenCalledWith(1, 10, 4);
		});

		it('clamps turn number to 0 minimum', async () => {
			mockEventData.value = createMockEvent({
				featureMatchDefaultTurnTrackingEnabled: true,
				featureMatchDefaultActivePlayerTrackingEnabled: false,
			});
			const mode = createSetup({ turnNumber: 0, firstPlayer: null, activePlayer: null });
			await mode.handleTurnChange(-1);
			expect(mockFeatureMatchStateStore.setTurnNumber).toHaveBeenCalledWith(1, 10, 0);
		});
	});

	describe('handleSelectFirstPlayer', () => {
		it('delegates to selectFirstPlayer', async () => {
			const mode = createSetup({ turnNumber: 1 });
			await mode.handleSelectFirstPlayer('player2');
			expect(mockFeatureMatchStateStore.selectFirstPlayer).toHaveBeenCalledWith(1, 10, 'player2');
		});
	});

	describe('handleNextOvertimeTurn', () => {
		it('delegates to nextOvertimeTurn', async () => {
			const mode = createSetup();
			await mode.handleNextOvertimeTurn();
			expect(mockFeatureMatchStateStore.nextOvertimeTurn).toHaveBeenCalledWith(1, 10);
		});
	});

	describe('handlePrevOvertimeTurn', () => {
		it('delegates to prevOvertimeTurn', async () => {
			const mode = createSetup();
			await mode.handlePrevOvertimeTurn();
			expect(mockFeatureMatchStateStore.prevOvertimeTurn).toHaveBeenCalledWith(1, 10);
		});
	});

	// ── handleCardsKeptUpdate ──

	describe('handleCardsKeptUpdate', () => {
		it('calls setCardsKept with player side and value', async () => {
			const mode = createSetup();
			await mode.handleCardsKeptUpdate('player1', 5);
			expect(mockFeatureMatchStateStore.setCardsKept).toHaveBeenCalledWith(1, 10, 'player1', 5);
		});

		it('calls setCardsKept for player2', async () => {
			const mode = createSetup();
			await mode.handleCardsKeptUpdate('player2', 4);
			expect(mockFeatureMatchStateStore.setCardsKept).toHaveBeenCalledWith(1, 10, 'player2', 4);
		});
	});

	// ── handleResetGame ──

	describe('handleResetGame', () => {
		it('calls resetMatch with type: game when confirmed', async () => {
			const mockOpen = vi.fn(() => ({ result: Promise.resolve(true) }));
			mockOverlay.create.mockReturnValueOnce({ open: mockOpen });
			const mode = createSetup();

			await mode.handleResetGame();

			expect(mockFeatureMatchStateStore.resetMatch).toHaveBeenCalledWith(1, 10, { type: 'game' });
		});
	});

	// ── matchActionItems ──

	describe('matchActionItems', () => {
		it('always offers Edit Match State, even with no other operational actions', () => {
			const mode = createSetup({ firstPlayer: null });
			const labels = mode.matchActionItems.value[0]!.map(a => a.label);
			expect(labels).toEqual(['Edit Match State…']);
		});

		it('includes Change First Player when active tracking enabled and firstPlayer set', () => {
			const mode = createSetup({ firstPlayer: 'player1' });
			const labels = mode.matchActionItems.value[0]!.map(a => a.label);
			expect(labels).toContain('Change First Player');
		});

		it('opens the edit-state modal from its action item', () => {
			const mode = createSetup();
			expect(mode.editStateOpen.value).toBe(false);

			const editItem = mode.matchActionItems.value[0]!.find(a => a.label === 'Edit Match State…')!;
			(editItem.onSelect as () => void)();

			expect(mode.editStateOpen.value).toBe(true);
		});
	});

	// ── handleEditStateSave ──

	describe('handleEditStateSave', () => {
		it('routes the whole diff through one updateState call and closes on success', async () => {
			mockFeatureMatchStateStore.updateState.mockResolvedValue(createMockFeatureMatchState());
			const mode = createSetup();
			mode.editStateOpen.value = true;

			await mode.handleEditStateSave({ turnNumber: 7, player1: { lifeTotal: 12 } });

			expect(mockFeatureMatchStateStore.updateState).toHaveBeenCalledExactlyOnceWith(
				1,
				10,
				{ turnNumber: 7, player1: { lifeTotal: 12 } },
			);
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

	describe('resetActionItems', () => {
		it('groups Reset Game and Reset Match together', () => {
			const mode = createSetup();
			const labels = mode.resetActionItems.value[0]!.map(a => a.label);
			expect(labels).toEqual(['Reset Game', 'Reset Match']);
		});
	});

	// ── startingHandSize ──

	describe('startingHandSize', () => {
		it('returns 7 for MTG', () => {
			const mode = createSetup();
			expect(mode.startingHandSize.value).toBe(7);
		});
	});

	// ── auto-start overtime watch ──

	describe('watch(isClockExpired)', () => {
		function createExpiredClock() {
			return {
				type: 'countdown' as const,
				durationMs: 60000,
				elapsedMs: 60001,
				isRunning: false,
				lastStartedAt: null,
				countUpAfterCountdown: false,
			};
		}

		function createActiveClock() {
			return {
				type: 'countdown' as const,
				durationMs: 60000,
				elapsedMs: 0,
				isRunning: false,
				lastStartedAt: null,
				countUpAfterCountdown: false,
			};
		}

		it('calls startOvertime when clock transitions to expired', async () => {
			const stateRef = shallowRef(createMockFeatureMatchState({ clock: createActiveClock() }));
			const matchState = computed(() => stateRef.value as FeatureMatchState);
			useFeatureMatchGameMode(10, matchState);

			stateRef.value = createMockFeatureMatchState({ clock: createExpiredClock() });
			await nextTick();

			expect(mockFeatureMatchStateStore.startOvertime).toHaveBeenCalledWith(1, 10, 5);
		});
	});
});
