import type { FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFeatureMatchOvertimeStep, applyFeatureMatchTurnStep } from '~~/shared/modules/feature-match-session';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

// Regression coverage for the combined turn+overtime batcher (`turnBatch` in
// featureMatchState.ts). Like featureMatchStateBatchClobber.test.ts, this suite does NOT
// mock the optimistic-state module/useAsyncAction/useDebounceFn — it exercises the real
// composable, real debounce timing, and the real store flush (which sends `stepTurn` then
// `stepOvertime` sequentially and merges the combined result), mocking only the repository.

const mockRepo = {
	loadState: vi.fn(),
	ensureSession: vi.fn(),
	updateState: vi.fn(),
	updatePlayerFeatureMatchState: vi.fn(),
	startClock: vi.fn(),
	pauseClock: vi.fn(),
	resetClock: vi.fn(),
	restartClock: vi.fn(),
	adjustClock: vi.fn(),
	setClock: vi.fn(),
	bulkClockAction: vi.fn(),
	recordGameWin: vi.fn(),
	undoGameWin: vi.fn(),
	resetMatch: vi.fn(),
	swapPlayers: vi.fn(),
	startOvertime: vi.fn(),
	stepTurn: vi.fn(),
	stepOvertime: vi.fn(),
};

vi.mock('~/modules/feature-match-session/client', () => ({
	useFeatureMatchSessionClient: () => mockRepo,
}));

mockNuxtImport('useServerTime', () => () => ({ getServerTime: () => 1000000 }));

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe('useFeatureMatchStateStore turn+overtime batch', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;

	const EVENT_ID = 1;
	const MATCH_ID = 100;

	function createSourceSnapshot(slotId = MATCH_ID): FeatureMatchSourceSnapshot {
		return {
			eventId: EVENT_ID,
			slotId,
			matchId: null,
			externalId: null,
			externalSource: null,
			tableNumber: null,
			bestOf: 3,
			playerDisplayMode: 'score',
			game: 'mtg',
			defaults: toFeatureMatchDefaults(null),
			player1: { playerId: null, data: null },
			player2: { playerId: null, data: null },
			createdAt: 1000000,
		};
	}

	function createSession(state: FeatureMatchState, sequence: number): FeatureMatchSessionResponse {
		return {
			id: 500,
			eventId: EVENT_ID,
			slotId: MATCH_ID,
			sourceSnapshot: createSourceSnapshot(),
			currentState: state,
			sequence,
			status: 'active',
			closedAt: null,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		};
	}

	function commandResult(state: FeatureMatchState, sequence: number) {
		return {
			featureMatchState: state,
			session: createSession(state, sequence),
			sequence,
		};
	}

	function seedMatch(): FeatureMatchState {
		const state = createMockFeatureMatchState({
			firstPlayer: 'player1',
			activePlayer: 'player1',
			turnNumber: 1,
			overtime: { active: true, turnsRemaining: 3, totalTurns: 5 },
		});
		store.featureMatchStates.set(MATCH_ID, state);
		return state;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		store = useFeatureMatchStateStore();
		store.$reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('sends one combined flush for a turn step and an overtime step in the same window, applying both effects', async () => {
		const initialState = seedMatch();

		let resolveStepTurn!: (result: ReturnType<typeof commandResult>) => void;
		let resolveStepOvertime!: (result: ReturnType<typeof commandResult>) => void;
		mockRepo.stepTurn.mockImplementation(() => new Promise((resolve) => {
			resolveStepTurn = resolve;
		}));
		mockRepo.stepOvertime.mockImplementation(() => new Promise((resolve) => {
			resolveStepOvertime = resolve;
		}));

		store.stepTurn(EVENT_ID, MATCH_ID, 1);
		store.nextOvertimeTurn(EVENT_ID, MATCH_ID);

		vi.advanceTimersByTime(400); // past the 300ms debounce window; triggers the one flush

		// The flush sends stepTurn first and awaits it before sending stepOvertime.
		expect(mockRepo.stepTurn).toHaveBeenCalledTimes(1);
		expect(mockRepo.stepOvertime).not.toHaveBeenCalled();

		const afterTurnStep = applyFeatureMatchTurnStep(initialState, 1);
		resolveStepTurn(commandResult(afterTurnStep, 4));
		await flushPromises();

		// stepOvertime is now sent, built on the turn step's already-committed result.
		expect(mockRepo.stepOvertime).toHaveBeenCalledTimes(1);

		const afterOvertimeStep = applyFeatureMatchOvertimeStep(afterTurnStep, 1);
		resolveStepOvertime(commandResult(afterOvertimeStep, 5));
		await flushPromises();

		const final = store.featureMatchStates.get(MATCH_ID)!;
		expect(final.turnNumber).toBe(afterOvertimeStep.turnNumber);
		expect(final.activePlayer).toBe(afterOvertimeStep.activePlayer);
		expect(final.overtime).toEqual(afterOvertimeStep.overtime);
	});

	it('keeps the committed turn step and only rolls back the overtime delta when stepOvertime fails', async () => {
		const initialState = seedMatch();

		let resolveStepTurn!: (result: ReturnType<typeof commandResult>) => void;
		let rejectStepOvertime!: (error: Error) => void;
		mockRepo.stepTurn.mockImplementation(() => new Promise((resolve) => {
			resolveStepTurn = resolve;
		}));
		mockRepo.stepOvertime.mockImplementation(() => new Promise((_resolve, reject) => {
			rejectStepOvertime = reject;
		}));

		store.stepTurn(EVENT_ID, MATCH_ID, 1);
		store.nextOvertimeTurn(EVENT_ID, MATCH_ID);

		vi.advanceTimersByTime(400);

		const afterTurnStep = applyFeatureMatchTurnStep(initialState, 1);
		resolveStepTurn(commandResult(afterTurnStep, 4));
		await flushPromises();

		expect(mockRepo.stepOvertime).toHaveBeenCalledTimes(1);

		rejectStepOvertime(new Error('overtime service unavailable'));
		await flushPromises();

		const final = store.featureMatchStates.get(MATCH_ID)!;
		// The turn step already committed server-side (session/sequence bumped) — a
		// whole-batch rollback would incorrectly revert it too. It must survive.
		expect(final.turnNumber).toBe(afterTurnStep.turnNumber);
		expect(final.activePlayer).toBe(afterTurnStep.activePlayer);
		// Only the overtime delta (which never committed) rolls back to its
		// pre-optimistic snapshot value.
		expect(final.overtime).toEqual(initialState.overtime);
		// The failure is still surfaced to the operator.
		expect(store.error).toContain('overtime service unavailable');
	});
});
