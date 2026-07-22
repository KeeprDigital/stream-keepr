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

describe('useFeatureMatchStateStore overtime actions', () => {
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

	describe('startOvertime', () => {
		it('optimistically sets overtime state', async () => {
			seedState();
			const withOvertime = createMockFeatureMatchState({
				overtime: { active: true, turnsRemaining: 5, totalTurns: 5 },
			});
			mockRepo.startOvertime.mockResolvedValue(commandResult(withOvertime));

			await store.startOvertime(EVENT_ID, MATCH_ID, 5);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.overtime).toEqual({ active: true, turnsRemaining: 5, totalTurns: 5 });
		});
	});

	describe('nextOvertimeTurn', () => {
		it('decrements turnsRemaining and toggles active player', () => {
			seedState({
				activePlayer: 'player1',
				overtime: { active: true, turnsRemaining: 3, totalTurns: 5 },
			});

			store.nextOvertimeTurn(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.overtime!.turnsRemaining).toBe(2);
			expect(result.activePlayer).toBe('player2');
		});

		it('deactivates overtime when turnsRemaining reaches 0', () => {
			seedState({
				activePlayer: 'player1',
				overtime: { active: true, turnsRemaining: 1, totalTurns: 5 },
			});

			store.nextOvertimeTurn(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.overtime!.turnsRemaining).toBe(0);
			expect(result.overtime!.active).toBe(false);
		});

		it('no-ops when overtime is not active', () => {
			seedState({
				activePlayer: 'player1',
				overtime: { active: false, turnsRemaining: 0, totalTurns: 5 },
			});

			store.nextOvertimeTurn(EVENT_ID, MATCH_ID);

			// activePlayer unchanged (no enqueue called due to guard)
			expect(store.featureMatchStates.get(MATCH_ID)!.activePlayer).toBe('player1');
		});

		it('no-ops when no overtime state', () => {
			seedState({ activePlayer: 'player1' });

			store.nextOvertimeTurn(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)!.activePlayer).toBe('player1');
		});
	});

	describe('prevOvertimeTurn', () => {
		it('increments turnsRemaining and toggles active player', () => {
			seedState({
				activePlayer: 'player2',
				overtime: { active: true, turnsRemaining: 2, totalTurns: 5 },
			});

			store.prevOvertimeTurn(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.overtime!.turnsRemaining).toBe(3);
			expect(result.activePlayer).toBe('player1');
			expect(result.overtime!.active).toBe(true);
		});

		it('caps turnsRemaining at totalTurns', () => {
			seedState({
				activePlayer: 'player1',
				overtime: { active: true, turnsRemaining: 5, totalTurns: 5 },
			});

			store.prevOvertimeTurn(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.overtime!.turnsRemaining).toBe(5); // capped
		});

		it('reactivates overtime when stepping back from inactive', () => {
			seedState({
				activePlayer: 'player1',
				overtime: { active: false, turnsRemaining: 0, totalTurns: 5 },
			});

			store.prevOvertimeTurn(EVENT_ID, MATCH_ID);

			const result = store.featureMatchStates.get(MATCH_ID)!;
			expect(result.overtime!.turnsRemaining).toBe(1);
			expect(result.overtime!.active).toBe(true);
		});

		it('no-ops when no overtime state', () => {
			seedState({ activePlayer: 'player1' });

			store.prevOvertimeTurn(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)!.activePlayer).toBe('player1');
		});
	});

	// ──────────────── Clock Settings ────────────────
});
