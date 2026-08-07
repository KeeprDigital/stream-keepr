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
/*
 * `useAsyncAction` is deliberately not mocked. The hand-written copy that stood here
 * reported `e.message` with no `instanceof Error` guard, where the real composable
 * reports 'An error occurred' for a rejection that is not an `Error` — and it called
 * `onError` with no argument and resolved `undefined` where the real one passes the
 * failure and resolves `null`. A copy of a seam drifts from what it copies (#241, #263).
 */
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

describe('useFeatureMatchStateStore clock actions', () => {
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

	describe('startClock', () => {
		it('optimistically sets isRunning true and lastStartedAt', async () => {
			seedState();
			const started = createMockFeatureMatchState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: true, lastStartedAt: 1000000, countUpAfterCountdown: false },
			});
			mockRepo.startClock.mockResolvedValue(commandResult(started));

			await store.startClock(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.clock.isRunning).toBe(true);
		});
	});

	describe('pauseClock', () => {
		it('optimistically sets isRunning false and accumulates elapsed', async () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 1000, isRunning: true, lastStartedAt: 999000, countUpAfterCountdown: false },
			});
			// getServerTime returns 1000000, so additional elapsed = 1000000 - 999000 = 1000
			const paused = createMockFeatureMatchState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 2000, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			});
			mockRepo.pauseClock.mockResolvedValue(commandResult(paused));

			await store.pauseClock(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)!.clock.isRunning).toBe(false);
		});
	});

	describe('resetClock', () => {
		it('optimistically resets elapsed to 0 and clears overtime', async () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 50000, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
				overtime: { active: true, turnsRemaining: 3, totalTurns: 5 },
			});
			const reset = createMockFeatureMatchState();
			mockRepo.resetClock.mockResolvedValue(commandResult(reset));

			await store.resetClock(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.clock.elapsedMs).toBe(0);
			expect(result.clock.isRunning).toBe(false);
		});
	});

	describe('restartClock', () => {
		it('optimistically resets elapsed to 0 and starts running', async () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 50000, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			});
			const restarted = createMockFeatureMatchState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: true, lastStartedAt: 1000000, countUpAfterCountdown: false },
			});
			mockRepo.restartClock.mockResolvedValue(commandResult(restarted));

			await store.restartClock(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.clock.isRunning).toBe(true);
			expect(result.clock.elapsedMs).toBe(0);
		});
	});

	describe('adjustClock', () => {
		it('applies optimistic clock adjustment via batch', () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			});

			store.adjustClock(EVENT_ID, MATCH_ID, 60000);

			// The batched update mock applies getOptimistic, which calls applyClockAdjustment
			const result = store.featureMatchStates.get(MATCH_ID)!;
			// For countdown: adds delta to durationMs (display increases)
			expect(result.clock.durationMs).toBe(3060000);
		});
	});

	describe('setClock', () => {
		it('optimistically sets clock to target via applyClockAdjustment', async () => {
			seedState({
				clock: { type: 'countup', durationMs: 0, elapsedMs: 10000, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			});
			const serverState = createMockFeatureMatchState({
				clock: { type: 'countup', durationMs: 0, elapsedMs: 60000, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			});
			mockRepo.setClock.mockResolvedValue(commandResult(serverState));

			await store.setClock(EVENT_ID, MATCH_ID, 60000);

			expect(store.featureMatchStates.get(MATCH_ID)!.clock.elapsedMs).toBe(60000);
		});
	});

	// ──────────────── Bulk Clock Actions ────────────────

	describe('bulkClockAction', () => {
		it('start: applies optimistic start to all non-running clocks', async () => {
			const stopped = seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			}, 100);
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: true, lastStartedAt: 999000, countUpAfterCountdown: false },
			}, 200);

			mockRepo.bulkClockAction.mockResolvedValue({
				updates: [
					{
						featureMatchId: 100,
						...commandResult(
							{ ...stopped, clock: { ...stopped.clock, isRunning: true, lastStartedAt: 1000000 } },
							{ slotId: 100 },
						),
					},
				],
			});

			await store.startAllClocks(EVENT_ID);

			// Match 100 should have been optimistically started
			expect(store.featureMatchStates.get(100)!.clock.isRunning).toBe(true);
		});

		it('pause: applies optimistic pause to all running clocks', async () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 1000, isRunning: true, lastStartedAt: 999000, countUpAfterCountdown: false },
			}, 100);
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			}, 200);

			mockRepo.bulkClockAction.mockResolvedValue({ updates: [] });

			await store.pauseAllClocks(EVENT_ID);

			// Match 100 (was running) should be paused
			expect(store.featureMatchStates.get(100)!.clock.isRunning).toBe(false);
			// Match 200 (already stopped) stays unchanged
			expect(store.featureMatchStates.get(200)!.clock.isRunning).toBe(false);
		});

		it('reset: resets all clocks and clears overtime', async () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 50000, isRunning: true, lastStartedAt: 999000, countUpAfterCountdown: false },
				overtime: { active: true, turnsRemaining: 3, totalTurns: 5 },
			}, 100);

			mockRepo.bulkClockAction.mockResolvedValue({ updates: [] });

			await store.resetAllClocks(EVENT_ID);

			const result = store.featureMatchStates.get(100)!;
			expect(result.clock.elapsedMs).toBe(0);
			expect(result.clock.isRunning).toBe(false);
			expect(result.overtime).toBeUndefined();
		});

		it('restart: resets and starts all clocks', async () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 50000, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			}, 100);

			mockRepo.bulkClockAction.mockResolvedValue({ updates: [] });

			await store.restartAllClocks(EVENT_ID);

			const result = store.featureMatchStates.get(100)!;
			expect(result.clock.elapsedMs).toBe(0);
			expect(result.clock.isRunning).toBe(true);
		});
	});

	describe('adjustAllClocks', () => {
		it('applies optimistic adjustment to all clocks', () => {
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			}, 100);
			seedState({
				clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: false, lastStartedAt: null, countUpAfterCountdown: false },
			}, 200);

			// Mock bulkClockAction for the debounced flush
			mockRepo.bulkClockAction.mockResolvedValue({ updates: [] });

			store.adjustAllClocks(EVENT_ID, 60000);

			// Both should have increased durationMs by 60000 for countdown
			expect(store.featureMatchStates.get(100)!.clock.durationMs).toBe(3060000);
			expect(store.featureMatchStates.get(200)!.clock.durationMs).toBe(3060000);
		});
	});

	// ──────────────── Player State ────────────────
});
