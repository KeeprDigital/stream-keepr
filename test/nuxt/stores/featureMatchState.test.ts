import type { FeatureMatchSessionEventAppliedPayload, FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

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

describe('useFeatureMatchStateStore', () => {
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

	describe('loadState', () => {
		it('populates featureMatchStates from repo', async () => {
			const state = createMockFeatureMatchState();
			mockRepo.ensureSession.mockResolvedValue(createSession(state));

			await store.loadState(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)).toEqual(state);
			expect(store.sessionIdBySlotId.get(MATCH_ID)).toBe(500);
			expect(store.sessionSequenceBySlotId.get(MATCH_ID)).toBe(3);
			expect(store.currentEventId).toBe(EVENT_ID);
		});

		it('sets an error when repo cannot provide a session', async () => {
			mockRepo.ensureSession.mockResolvedValue(null);

			await store.loadState(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)).toBeUndefined();
			expect(store.error).toBe('Feature match session not found');
		});

		it('sets loading during fetch', async () => {
			let loadingDuringFetch = false;
			mockRepo.ensureSession.mockImplementation(async () => {
				loadingDuringFetch = store.loading;
				return createSession();
			});

			await store.loadState(EVENT_ID, MATCH_ID);

			expect(loadingDuringFetch).toBe(true);
			expect(store.loading).toBe(false);
		});
	});

	describe('failure reporting', () => {
		it('reports the sentence a refused load carries', async () => {
			mockRepo.ensureSession.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'That Feature Match slot is not assigned to a match yet' },
				request: `[POST] "/api/events/1/feature-matches/42/session"`,
			}));

			await store.loadState(EVENT_ID, MATCH_ID);

			expect(store.error).toBe('That Feature Match slot is not assigned to a match yet');
		});

		it('reports the sentence a refused optimistic action carries, and rolls the prediction back', async () => {
			const state = seedState({ turnNumber: 1 });
			mockRepo.updateState.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'This Feature Match has already been reset' },
			}));

			await store.updateState(EVENT_ID, MATCH_ID, { turnNumber: 2 });

			expect(store.error).toBe('This Feature Match has already been reset');
			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(state.turnNumber);
		});
	});

	describe('setActiveFeatureMatch', () => {
		it('sets activeFeatureMatchId', () => {
			store.setActiveFeatureMatch(42);
			expect(store.activeFeatureMatchId).toBe(42);
		});

		it('clears activeFeatureMatchId with null', () => {
			store.activeFeatureMatchId = 42;
			store.setActiveFeatureMatch(null);
			expect(store.activeFeatureMatchId).toBeNull();
		});
	});

	describe('activeState', () => {
		it('returns state for active match', () => {
			const state = seedState({}, 42);
			store.activeFeatureMatchId = 42;
			expect(store.activeState).toEqual(state);
		});
	});

	// ──────────────── State Updates ────────────────

	describe('updateState', () => {
		it('applies partial state merge optimistically', async () => {
			seedState();
			const serverState = createMockFeatureMatchState({ turnNumber: 5 });
			mockRepo.updateState.mockResolvedValue(commandResult(serverState));

			await store.updateState(EVENT_ID, MATCH_ID, { turnNumber: 5 });

			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(5);
		});

		it('rolls back every field of a failed multi-field save, leaving no partial state', async () => {
			const state = seedState({ turnNumber: 2 });
			mockRepo.updateState.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'Feature match session has advanced' },
			}));

			await store.updateState(EVENT_ID, MATCH_ID, {
				turnNumber: 9,
				activePlayer: 'player2',
				player1: { lifeTotal: 3 },
				clock: { targetDisplayMs: 60_000 },
			});

			expect(store.error).toBe('Feature match session has advanced');
			expect(store.featureMatchStates.get(MATCH_ID)).toEqual(state);
		});

		it('merges player sub-objects', async () => {
			seedState();
			const serverState = createMockFeatureMatchState({
				player1: { lifeTotal: 15, gameWins: 0, counters: [], sideboardRevealed: false },
			});
			mockRepo.updateState.mockResolvedValue(commandResult(serverState));

			await store.updateState(EVENT_ID, MATCH_ID, { player1: { lifeTotal: 15 } });

			expect(store.featureMatchStates.get(MATCH_ID)!.player1.lifeTotal).toBe(15);
		});

		it('predicts a clock save as the display reading, not raw elapsed milliseconds', async () => {
			// Paused countdown: 50:00 duration, 10:00 elapsed → the panel shows 40:00.
			seedState({
				clock: {
					type: 'countdown',
					durationMs: 50 * 60 * 1000,
					elapsedMs: 10 * 60 * 1000,
					isRunning: false,
					lastStartedAt: null,
					countUpAfterCountdown: false,
				},
			});
			let predicted: { durationMs: number; elapsedMs: number } | undefined;
			mockRepo.updateState.mockImplementation(async () => {
				const clock = store.featureMatchStates.get(MATCH_ID)!.clock;
				predicted = { durationMs: clock.durationMs, elapsedMs: clock.elapsedMs };
				return commandResult();
			});

			// The operator types 10:00 — the clock should read 10:00, not 40:00.
			await store.updateState(EVENT_ID, MATCH_ID, { clock: { targetDisplayMs: 10 * 60 * 1000 } });

			expect(predicted).toBeDefined();
			expect(predicted!.durationMs - predicted!.elapsedMs).toBe(10 * 60 * 1000);
		});
	});

	// ──────────────── Clock Actions ────────────────

	describe('updateAllClockSettings', () => {
		it('updates clockType on all matches', () => {
			seedState({}, 100);
			seedState({}, 200);

			store.updateAllClockSettings('countup');

			expect(store.featureMatchStates.get(100)!.clock.type).toBe('countup');
			expect(store.featureMatchStates.get(200)!.clock.type).toBe('countup');
		});

		it('updates durationMs on all matches', () => {
			seedState({}, 100);
			seedState({}, 200);

			store.updateAllClockSettings(undefined, 6000000);

			expect(store.featureMatchStates.get(100)!.clock.durationMs).toBe(6000000);
			expect(store.featureMatchStates.get(200)!.clock.durationMs).toBe(6000000);
		});

		it('updates countUpAfterCountdown on all matches', () => {
			seedState({}, 100);

			store.updateAllClockSettings(undefined, undefined, true);

			expect(store.featureMatchStates.get(100)!.clock.countUpAfterCountdown).toBe(true);
		});

		it('updates multiple settings at once', () => {
			seedState({}, 100);

			store.updateAllClockSettings('countup', 1800000, true);

			const clock = store.featureMatchStates.get(100)!.clock;
			expect(clock.type).toBe('countup');
			expect(clock.durationMs).toBe(1800000);
			expect(clock.countUpAfterCountdown).toBe(true);
		});
	});

	// ──────────────── Realtime Handlers ────────────────

	describe('realtime handlers', () => {
		function sessionEvent(
			overrides: Partial<FeatureMatchSessionEventAppliedPayload> = {},
		): MessageData<'featureMatchSession:eventApplied'> {
			return {
				eventId: EVENT_ID,
				timestamp: Date.now(),
				slotId: MATCH_ID,
				sessionId: 500,
				sequence: 4,
				eventType: 'SetTurnNumber',
				sourceSnapshot: createSourceSnapshot(),
				currentState: createMockFeatureMatchState({ turnNumber: 4 }),
				...overrides,
			};
		}

		it('applies the next event for the current session', async () => {
			store.cacheSession(createSession());

			await store.applyRemoteSessionEvent(sessionEvent());

			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(4);
			expect(store.sessionSequenceBySlotId.get(MATCH_ID)).toBe(4);
		});

		it('updates cached session snapshot for accepted events', async () => {
			store.cacheSession(createSession());
			const nextSnapshot = { ...createSourceSnapshot(), bestOf: 5 };

			await store.applyRemoteSessionEvent(sessionEvent({ sourceSnapshot: nextSnapshot }));

			expect(store.featureMatchSessions.get(500)?.sourceSnapshot.bestOf).toBe(5);
			expect(store.featureMatchSessions.get(500)?.sequence).toBe(4);
		});

		it('switches to a newer active session immediately', async () => {
			store.cacheSession(createSession());
			const nextState = createMockFeatureMatchState({ currentGame: 2 });

			await store.applyRemoteSessionEvent(sessionEvent({
				sessionId: 600,
				sequence: 1,
				currentState: nextState,
			}));

			expect(store.sessionIdBySlotId.get(MATCH_ID)).toBe(600);
			expect(store.sessionSequenceBySlotId.get(MATCH_ID)).toBe(1);
			expect(store.featureMatchStates.get(MATCH_ID)).toEqual(nextState);
			expect(store.featureMatchSessions.get(600)?.currentState).toEqual(nextState);
		});

		it('refetches when an event sequence gap is detected', async () => {
			store.cacheSession(createSession());
			mockRepo.ensureSession.mockResolvedValue(createSession(createMockFeatureMatchState({ turnNumber: 8 })));

			await store.applyRemoteSessionEvent(sessionEvent({ sequence: 6 }));

			expect(mockRepo.ensureSession).toHaveBeenCalledWith(EVENT_ID, MATCH_ID);
			expect(store.featureMatchStates.get(MATCH_ID)!.turnNumber).toBe(8);
		});
	});

	// ──────────────── $reset ────────────────

	describe('$reset', () => {
		it('clears all state', () => {
			store.featureMatchStates.set(100, createMockFeatureMatchState());
			store.featureMatchStates.set(200, createMockFeatureMatchState());
			store.activeFeatureMatchId = 100;
			store.error = 'some error';
			store.currentEventId = 1;

			store.$reset();

			expect(store.featureMatchStates.size).toBe(0);
			expect(store.activeFeatureMatchId).toBeNull();
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.currentEventId).toBeNull();
		});
	});

	// ──────────────── Optimistic Rollback ────────────────

	// ──────────────── Action Guard (dedup) ────────────────

	describe('action guard deduplication', () => {
		it('drops concurrent startClock calls for same match', async () => {
			seedState();
			let resolveFirst!: (v: ReturnType<typeof commandResult>) => void;
			const firstCall = new Promise<ReturnType<typeof commandResult>>(r => resolveFirst = r);
			mockRepo.startClock.mockReturnValueOnce(firstCall);

			const promise1 = store.startClock(EVENT_ID, MATCH_ID);
			const promise2 = store.startClock(EVENT_ID, MATCH_ID);

			expect(promise2).toBeNull(); // dropped by guard

			resolveFirst(commandResult(createMockFeatureMatchState({ clock: { type: 'countdown', durationMs: 3000000, elapsedMs: 0, isRunning: true, lastStartedAt: 1000000, countUpAfterCountdown: false } })));
			await promise1;

			expect(mockRepo.startClock).toHaveBeenCalledTimes(1);
		});
	});
});
