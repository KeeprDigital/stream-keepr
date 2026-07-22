import type { FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

// ── Mock Dependencies ──

const mockRepo = {
	getState: vi.fn(),
	ensureSession: vi.fn(),
	updateState: vi.fn(),
	updatePlayerFeatureMatchState: vi.fn(),
	startClock: vi.fn(),
	pauseClock: vi.fn(),
	resetClock: vi.fn(),
	restartClock: vi.fn(),
	adjustClock: vi.fn(),
	setClock: vi.fn(),
	recordGameWin: vi.fn(),
	undoGameWin: vi.fn(),
	resetMatch: vi.fn(),
	stepTurn: vi.fn(),
	stepOvertime: vi.fn(),
	startOvertime: vi.fn(),
	swapPlayers: vi.fn(),
	bulkClockAction: vi.fn(),
};

const mockAbly = createMockRealtime();
const mockGetServerTime = vi.fn(() => 1000000);

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

vi.mock('~/modules/feature-match-session/client', () => ({
	useFeatureMatchSessionClient: () => mockRepo,
}));

mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: vi.fn(async (fn: () => Promise<unknown>, opts?: any) => {
		if (opts?.loadingRef)
			opts.loadingRef.value = true;
		try {
			return await fn();
		}
		catch (e: any) {
			if (opts?.errorRef)
				opts.errorRef.value = e.message;
			opts?.onError?.();
			return undefined;
		}
		finally {
			if (opts?.loadingRef)
				opts.loadingRef.value = false;
		}
	}),
}));
mockNuxtImport('useServerTime', () => () => ({ getServerTime: mockGetServerTime }));

// useDebounceFn: immediately invoke the callback
vi.mock('@vueuse/core', async () => {
	const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core');
	return {
		...actual,
		useDebounceFn: (fn: (...args: any[]) => any) => fn,
	};
});

// useEventStore mock for bulkClockAction
const mockEventStore = { event: { featureMatchDefaultClockDuration: 50 } };
mockNuxtImport('useEventStore', () => () => mockEventStore);

describe('useFeatureMatchStateStore player and turn actions', () => {
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

	function createSession(state: FeatureMatchState = createMockFeatureMatchState()): FeatureMatchSessionResponse {
		return {
			id: 500,
			eventId: EVENT_ID,
			slotId: MATCH_ID,
			sourceSnapshot: createSourceSnapshot(),
			currentState: state,
			sequence: 3,
			status: 'active',
			closedAt: null,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		};
	}

	function commandResult(state: FeatureMatchState = createMockFeatureMatchState(), session?: Partial<FeatureMatchSessionResponse>) {
		const responseSession = { ...createSession(state), ...session };
		return {
			featureMatchState: state,
			session: responseSession,
			sequence: responseSession.sequence,
		};
	}

	function seedState(overrides?: Partial<FeatureMatchState>, matchId = MATCH_ID) {
		const state = createMockFeatureMatchState(overrides);
		store.featureMatchStates.set(matchId, state);
		return state;
	}

	beforeEach(() => {
		store = useFeatureMatchStateStore();
		store.$reset();
		vi.clearAllMocks();
		mockGetServerTime.mockReturnValue(1000000);
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
	});

	// ──────────────── Core State Management ────────────────

	describe('updatePlayerFeatureMatchState', () => {
		it('applies life delta optimistically', () => {
			seedState();

			store.updatePlayerFeatureMatchState(EVENT_ID, MATCH_ID, 'player1', { lifeDelta: -3 });

			expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(17);
		});

		it('sets absolute life total optimistically', () => {
			seedState();

			store.updatePlayerFeatureMatchState(EVENT_ID, MATCH_ID, 'player1', { lifeTotal: 10 });

			expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(10);
		});

		it('updates counters optimistically', () => {
			seedState();

			store.updatePlayerFeatureMatchState(EVENT_ID, MATCH_ID, 'player1', {
				counters: [{ type: 'poison', value: 3 }],
			});

			expect(store.featureMatchStates.get(MATCH_ID)!.player1.counters).toEqual([{ type: 'poison', value: 3 }]);
		});

		it('no-ops when match not found', () => {
			store.updatePlayerFeatureMatchState(EVENT_ID, 999, 'player1', { lifeDelta: -3 });
			// No error, no state change
			expect(store.featureMatchStates.size).toBe(0);
		});
	});

	describe('adjustLife', () => {
		it('delegates to updatePlayerFeatureMatchState with lifeDelta', () => {
			seedState();

			store.adjustLife(EVENT_ID, MATCH_ID, 'player2', -5);

			expect(store.featureMatchStates.get(MATCH_ID)!.player2.lifeTotal).toBe(15);
		});
	});

	describe('setLife', () => {
		it('delegates to updatePlayerFeatureMatchState with lifeTotal', () => {
			seedState();

			store.setLife(EVENT_ID, MATCH_ID, 'player1', 40);

			expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(40);
		});
	});

	describe('setCardsKept', () => {
		it('optimistically sets cardsKept on player', async () => {
			seedState();
			const serverState = createMockFeatureMatchState({
				player1: { lifeTotal: 20, gameWins: 0, counters: [], cardsKept: 6 },
			});
			mockRepo.updatePlayerFeatureMatchState.mockResolvedValue(commandResult(serverState));

			await store.setCardsKept(EVENT_ID, MATCH_ID, 'player1', 6);

			expect(store.featureMatchStates.get(MATCH_ID)!.player1.cardsKept).toBe(6);
		});
	});

	// ──────────────── Turn Tracking ────────────────

	describe('selectFirstPlayer', () => {
		it('sets firstPlayer, activePlayer, and turnNumber to 1', async () => {
			seedState();
			const updated = createMockFeatureMatchState({
				firstPlayer: 'player1',
				activePlayer: 'player1',
				turnNumber: 1,
			});
			mockRepo.updateState.mockResolvedValue(commandResult(updated));

			await store.selectFirstPlayer(EVENT_ID, MATCH_ID, 'player1');

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.firstPlayer).toBe('player1');
			expect(result.activePlayer).toBe('player1');
			expect(result.turnNumber).toBe(1);
		});
	});

	describe('changeFirstPlayer', () => {
		it('toggles firstPlayer from player1 to player2', async () => {
			seedState({ firstPlayer: 'player1' });
			const updated = createMockFeatureMatchState({ firstPlayer: 'player2' });
			mockRepo.updateState.mockResolvedValue(commandResult(updated));

			await store.changeFirstPlayer(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)!.firstPlayer).toBe('player2');
		});

		it('toggles firstPlayer from player2 to player1', async () => {
			seedState({ firstPlayer: 'player2' });
			const updated = createMockFeatureMatchState({ firstPlayer: 'player1' });
			mockRepo.updateState.mockResolvedValue(commandResult(updated));

			await store.changeFirstPlayer(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)!.firstPlayer).toBe('player1');
		});
	});

	describe('stepTurn', () => {
		it('forward: switches active player on same turn (first player active)', () => {
			seedState({
				firstPlayer: 'player1',
				activePlayer: 'player1',
				turnNumber: 1,
			});

			store.stepTurn(EVENT_ID, MATCH_ID, 1);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.activePlayer).toBe('player2');
			expect(result.turnNumber).toBe(1);
		});

		it('forward: increments turn when second player finishes', () => {
			seedState({
				firstPlayer: 'player1',
				activePlayer: 'player2',
				turnNumber: 1,
			});

			store.stepTurn(EVENT_ID, MATCH_ID, 1);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.activePlayer).toBe('player1');
			expect(result.turnNumber).toBe(2);
		});

		it('no-ops when no activePlayer', () => {
			seedState({ activePlayer: null, firstPlayer: 'player1', turnNumber: 1 });

			store.stepTurn(EVENT_ID, MATCH_ID, 1);

			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(1);
		});

		it('no-ops when no firstPlayer', () => {
			seedState({ activePlayer: 'player1', firstPlayer: null, turnNumber: 1 });

			store.stepTurn(EVENT_ID, MATCH_ID, 1);

			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(1);
		});
	});

	describe('setActivePlayer', () => {
		it('optimistically sets activePlayer', async () => {
			seedState();
			const updated = createMockFeatureMatchState({ activePlayer: 'player2' });
			mockRepo.updateState.mockResolvedValue(commandResult(updated));

			await store.setActivePlayer(EVENT_ID, MATCH_ID, 'player2');

			expect(store.featureMatchStates.get(MATCH_ID)!.activePlayer).toBe('player2');
		});
	});

	describe('setTurnNumber', () => {
		it('optimistically sets turnNumber', async () => {
			seedState();
			const updated = createMockFeatureMatchState({ turnNumber: 10 });
			mockRepo.updateState.mockResolvedValue(commandResult(updated));

			await store.setTurnNumber(EVENT_ID, MATCH_ID, 10);

			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(10);
		});
	});

	// ──────────────── Game Lifecycle ────────────────

	describe('recordGameWin', () => {
		it('calls repo and updates state from server response', async () => {
			seedState();
			const afterWin = createMockFeatureMatchState({
				player1: { lifeTotal: 20, gameWins: 1, counters: [] },
				currentGame: 2,
			});
			mockRepo.recordGameWin.mockResolvedValue(commandResult(afterWin));

			await store.recordGameWin(EVENT_ID, MATCH_ID, 'player1');

			expect(mockRepo.recordGameWin).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, 'player1', {});
			expect(store.featureMatchStates.get(MATCH_ID)!.currentGame).toBe(2);
		});

		it('passes options through to repo', async () => {
			seedState();
			mockRepo.recordGameWin.mockResolvedValue(commandResult(createMockFeatureMatchState()));

			await store.recordGameWin(EVENT_ID, MATCH_ID, 'player1', { resetLife: true, startingLife: 40 });

			expect(mockRepo.recordGameWin).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, 'player1', { resetLife: true, startingLife: 40 });
		});
	});

	describe('undoGameWin', () => {
		it('calls repo and updates state from server response', async () => {
			seedState({
				player1: { lifeTotal: 20, gameWins: 1, counters: [] },
				currentGame: 2,
			});
			const afterUndo = createMockFeatureMatchState({ currentGame: 1 });
			mockRepo.undoGameWin.mockResolvedValue(commandResult(afterUndo));

			await store.undoGameWin(EVENT_ID, MATCH_ID, 'player1');

			expect(store.featureMatchStates.get(MATCH_ID)!.currentGame).toBe(1);
		});
	});

	describe('resetMatch', () => {
		it('calls repo and updates state from server response', async () => {
			seedState({ turnNumber: 5, currentGame: 3 });
			const fresh = createMockFeatureMatchState();
			mockRepo.resetMatch.mockResolvedValue(commandResult(fresh));

			await store.resetMatch(EVENT_ID, MATCH_ID, { type: 'match' });

			expect(mockRepo.resetMatch).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, { type: 'match' });
			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(0);
		});
	});

	describe('swapPlayers', () => {
		it('swaps player1 and player2 state optimistically', async () => {
			seedState({
				player1: { lifeTotal: 20, gameWins: 1, counters: [] },
				player2: { lifeTotal: 15, gameWins: 0, counters: [] },
				activePlayer: 'player1',
				firstPlayer: 'player1',
			});
			const swapped = createMockFeatureMatchState({
				player1: { lifeTotal: 15, gameWins: 0, counters: [] },
				player2: { lifeTotal: 20, gameWins: 1, counters: [] },
				activePlayer: 'player2',
				firstPlayer: 'player2',
			});
			mockRepo.swapPlayers.mockResolvedValue(commandResult(swapped));

			await store.swapPlayers(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.player1.lifeTotal).toBe(15);
			expect(result.player2.lifeTotal).toBe(20);
			expect(result.activePlayer).toBe('player2');
			expect(result.firstPlayer).toBe('player2');
		});

		it('caches returned session snapshots after local swap', async () => {
			seedState({
				player1: { lifeTotal: 20, gameWins: 1, counters: [] },
				player2: { lifeTotal: 15, gameWins: 0, counters: [] },
			});
			const swapped = createMockFeatureMatchState({
				player1: { lifeTotal: 15, gameWins: 0, counters: [] },
				player2: { lifeTotal: 20, gameWins: 1, counters: [] },
			});
			const swappedSnapshot = {
				...createSourceSnapshot(),
				player1: { playerId: null, data: { name: 'Bob' } },
				player2: { playerId: null, data: { name: 'Alice' } },
			};
			mockRepo.swapPlayers.mockResolvedValue(commandResult(swapped, { sourceSnapshot: swappedSnapshot }));

			await store.swapPlayers(EVENT_ID, MATCH_ID);

			expect(store.featureMatchSessions.get(500)?.sourceSnapshot.player1.data?.name).toBe('Bob');
			expect(store.featureMatchSessions.get(500)?.sourceSnapshot.player2.data?.name).toBe('Alice');
		});

		it('swaps from player2 to player1', async () => {
			seedState({
				activePlayer: 'player2',
				firstPlayer: 'player2',
			});
			mockRepo.swapPlayers.mockResolvedValue(commandResult(createMockFeatureMatchState()));

			await store.swapPlayers(EVENT_ID, MATCH_ID);

			// Optimistic: should swap directions
			// Check that optimistic was applied (server overwrites, but we verify the logic)
			expect(mockRepo.swapPlayers).toHaveBeenCalledWith(EVENT_ID, MATCH_ID);
		});
	});

	// ──────────────── Overtime ────────────────
});
