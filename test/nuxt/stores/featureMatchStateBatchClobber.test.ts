import type { FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

// Regression test for the batched-optimistic-update clobber bug. Unlike the sibling
// featureMatchState*.test.ts files, this suite does NOT mock the optimistic-state module,
// useAsyncAction, or useDebounceFn — it exercises the real composable, the real debounce
// timing (with fake timers), and the real cacheCommandResult/cacheSession wiring in the
// store, mocking only the network-facing repository. A whole-entry `featureMatchStates`
// write inside cacheSession (which every batched flush routes through) would clobber a
// concurrent key's still-pending optimistic value even if the composable's own merge
// hook is otherwise correct — the fully-mocked composable in the other test files cannot
// catch that, because it never exercises the store's cacheCommandResult/cacheSession path.

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

describe('useFeatureMatchStateStore batched flush clobber regression', () => {
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

	beforeEach(() => {
		vi.useFakeTimers();
		store = useFeatureMatchStateStore();
		store.$reset();
		vi.clearAllMocks();
		store.featureMatchStates.set(MATCH_ID, createMockFeatureMatchState({
			player1: { lifeTotal: 20, gameWins: 0, counters: [] },
			player2: { lifeTotal: 20, gameWins: 0, counters: [] },
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not let player1\'s flush clobber player2\'s still-pending optimistic life total', async () => {
		let resolvePlayer1!: (result: ReturnType<typeof commandResult>) => void;
		let resolvePlayer2!: (result: ReturnType<typeof commandResult>) => void;

		mockRepo.updatePlayerFeatureMatchState.mockImplementation((_eventId: number, _matchId: number, player: string) => {
			return new Promise((resolve) => {
				if (player === 'player1')
					resolvePlayer1 = resolve;
				else
					resolvePlayer2 = resolve;
			});
		});

		store.adjustLife(EVENT_ID, MATCH_ID, 'player1', -3);
		store.adjustLife(EVENT_ID, MATCH_ID, 'player2', -5);

		// Optimistic values applied immediately for both players.
		expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(17);
		expect(store.featureMatchStates.get(MATCH_ID)!.player2.lifeTotal).toBe(15);

		vi.advanceTimersByTime(400); // past the 300ms debounce window; triggers both flushes

		// Player1's server response reflects a base state that predates player2's edit
		// (player2 is still 20 server-side) — a whole-entry write anywhere on this path
		// would revert player2's optimistic 15 back to 20.
		const player1Confirmed = createMockFeatureMatchState({
			player1: { lifeTotal: 17, gameWins: 0, counters: [] },
			player2: { lifeTotal: 20, gameWins: 0, counters: [] },
		});
		resolvePlayer1(commandResult(player1Confirmed, 4));
		await flushPromises();

		const afterPlayer1Flush = store.featureMatchStates.get(MATCH_ID)!;
		expect(afterPlayer1Flush.player1.lifeTotal).toBe(17);
		expect(afterPlayer1Flush.player2.lifeTotal).toBe(15); // still optimistic, not clobbered

		// Player2's flush now lands with the fully-agreed final state.
		const player2Confirmed = createMockFeatureMatchState({
			player1: { lifeTotal: 17, gameWins: 0, counters: [] },
			player2: { lifeTotal: 15, gameWins: 0, counters: [] },
		});
		resolvePlayer2(commandResult(player2Confirmed, 5));
		await flushPromises();

		const final = store.featureMatchStates.get(MATCH_ID)!;
		expect(final.player1.lifeTotal).toBe(17);
		expect(final.player2.lifeTotal).toBe(15);
	});

	it('does not let a non-batched action\'s success clobber a still-pending batched life edit', async () => {
		// The life edit's flush never starts (debounce not advanced) — its
		// optimistic value only exists locally.
		store.adjustLife(EVENT_ID, MATCH_ID, 'player1', -3);
		expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(17);

		// A non-batched action succeeds with server state that predates the life
		// edit (player1 still 20 server-side). It only owns `activePlayer` — a
		// whole-state write here would revert the pending life edit.
		const serverState = createMockFeatureMatchState({
			player1: { lifeTotal: 20, gameWins: 0, counters: [] },
			player2: { lifeTotal: 20, gameWins: 0, counters: [] },
			activePlayer: 'player2',
		});
		mockRepo.updateState.mockResolvedValue(commandResult(serverState, 4));

		await store.setActivePlayer(EVENT_ID, MATCH_ID, 'player2');
		await flushPromises();

		const state = store.featureMatchStates.get(MATCH_ID)!;
		expect(state.activePlayer).toBe('player2');
		expect(state.player1.lifeTotal).toBe(17); // pending edit survives
	});

	it('rolling back a non-batched action restores only its owned fields', async () => {
		// The non-batched action starts FIRST, so its rollback snapshot predates
		// the life edit — a whole-state rollback would revert the life edit too.
		let rejectUpdateState!: (error: Error) => void;
		mockRepo.updateState.mockImplementation(() => new Promise((_resolve, reject) => {
			rejectUpdateState = reject;
		}));

		const pending = store.setActivePlayer(EVENT_ID, MATCH_ID, 'player2');
		store.adjustLife(EVENT_ID, MATCH_ID, 'player1', -3);
		expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(17);

		rejectUpdateState(new Error('network error'));
		await pending;
		await flushPromises();

		const state = store.featureMatchStates.get(MATCH_ID)!;
		expect(state.activePlayer).toBeNull(); // rolled back
		expect(state.player1.lifeTotal).toBe(17); // pending edit survives the rollback
	});

	it('accumulates rapid life deltas into one flush with the merged payload', async () => {
		const confirmed = createMockFeatureMatchState({
			player1: { lifeTotal: 10, gameWins: 0, counters: [] },
			player2: { lifeTotal: 20, gameWins: 0, counters: [] },
		});
		mockRepo.updatePlayerFeatureMatchState.mockResolvedValue(commandResult(confirmed, 4));

		for (let i = 0; i < 10; i++)
			store.adjustLife(EVENT_ID, MATCH_ID, 'player1', -1);

		expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(10);
		expect(mockRepo.updatePlayerFeatureMatchState).not.toHaveBeenCalled();

		vi.advanceTimersByTime(400);
		await flushPromises();

		expect(mockRepo.updatePlayerFeatureMatchState).toHaveBeenCalledOnce();
		expect(mockRepo.updatePlayerFeatureMatchState).toHaveBeenCalledWith(
			EVENT_ID,
			MATCH_ID,
			'player1',
			{ lifeDelta: -10 },
		);
		expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(10);
	});

	it('a remote session event landing while a life edit is pending merges around its Field Ownership', async () => {
		// Operator taps life -3 — optimistic, batch still pending (debounce not advanced).
		store.adjustLife(EVENT_ID, MATCH_ID, 'player1', -3);
		expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(17);

		// A remote frame arrives reflecting server state that predates the tap
		// (player1 still 20 there), but carries a real remote change to player2.
		const remoteState = createMockFeatureMatchState({
			player1: { lifeTotal: 20, gameWins: 0, counters: [] },
			player2: { lifeTotal: 12, gameWins: 0, counters: [] },
		});
		await store.applyRemoteSessionEvent({
			eventId: EVENT_ID,
			slotId: MATCH_ID,
			sessionId: 500,
			sourceSnapshot: createSourceSnapshot(),
			currentState: remoteState,
			sequence: 4,
			timestamp: new Date('2026-01-01T00:00:10.000Z').toISOString(),
		} as any);

		const state = store.featureMatchStates.get(MATCH_ID)!;
		expect(state.player2.lifeTotal).toBe(12); // remote change applies
		expect(state.player1.lifeTotal).toBe(17); // pending tap survives
	});
});
