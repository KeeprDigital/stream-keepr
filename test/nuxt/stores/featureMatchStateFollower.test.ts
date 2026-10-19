import type { FeatureMatchSessionEventAppliedPayload, FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

/**
 * The Feature Match Session client following its aggregate through the Live State
 * Follower: the real store, the real optimistic-state module and the real debounce
 * (on fake timers), with only the session client mocked so each answer's arrival
 * order is the test's to choose.
 */

const mockRepo = {
	ensureSession: vi.fn(),
	updateState: vi.fn(),
	updatePlayerFeatureMatchState: vi.fn(),
};

vi.mock('~/modules/feature-match-session/client', () => ({
	useFeatureMatchSessionClient: () => mockRepo,
}));

mockNuxtImport('useServerTime', () => () => ({ getServerTime: () => 1000000 }));

async function flushPromises() {
	for (let i = 0; i < 6; i++)
		await Promise.resolve();
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const EVENT_ID = 1;
const SLOT_ID = 100;

function sourceSnapshot(): FeatureMatchSourceSnapshot {
	return {
		eventId: EVENT_ID,
		slotId: SLOT_ID,
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

function state(overrides: { life1?: number; life2?: number; revealed?: boolean; cardsKept1?: number } = {}): FeatureMatchState {
	const base = createMockFeatureMatchState();
	return {
		...base,
		player1: {
			...base.player1,
			lifeTotal: overrides.life1 ?? 20,
			sideboardRevealed: overrides.revealed ?? false,
			...(overrides.cardsKept1 !== undefined && { cardsKept: overrides.cardsKept1 }),
		},
		player2: { ...base.player2, lifeTotal: overrides.life2 ?? 20, sideboardRevealed: overrides.revealed ?? false },
	};
}

function session(id: number, sequence: number, currentState: FeatureMatchState): FeatureMatchSessionResponse {
	return {
		id,
		eventId: EVENT_ID,
		slotId: SLOT_ID,
		sourceSnapshot: sourceSnapshot(),
		currentState,
		sequence,
		status: 'active',
		closedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

function commandResult(id: number, sequence: number, currentState: FeatureMatchState) {
	return { featureMatchState: currentState, session: session(id, sequence, currentState), sequence };
}

function notification(
	sessionId: number,
	sequence: number,
	currentState: FeatureMatchState,
	overrides: Partial<FeatureMatchSessionEventAppliedPayload> = {},
): MessageData<'featureMatchSession:eventApplied'> {
	return {
		eventId: EVENT_ID,
		timestamp: Date.now(),
		slotId: SLOT_ID,
		sessionId,
		sequence,
		eventType: 'SetLife',
		sourceSnapshot: sourceSnapshot(),
		currentState,
		...overrides,
	};
}

describe('the Feature Match Session client following its aggregate', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;

	beforeEach(() => {
		vi.useFakeTimers();
		store = useFeatureMatchStateStore();
		store.$reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function rendered() {
		return store.featureMatchStates.get(SLOT_ID)!;
	}

	describe('command answers arriving out of order (review F04)', () => {
		it('an older reveal answering after a newer life change regresses neither', async () => {
			store.cacheSession(session(500, 0, state()));
			const reveal = deferred<ReturnType<typeof commandResult>>();
			const life = deferred<ReturnType<typeof commandResult>>();
			mockRepo.updateState.mockReturnValue(reveal.promise);
			mockRepo.updatePlayerFeatureMatchState.mockReturnValue(life.promise);

			// Show sideboards is accepted at sequence 1, its answer delayed.
			void store.setSideboardRevealed(EVENT_ID, SLOT_ID, true);
			// A Player 1 life decrement is accepted at sequence 2 and answers first.
			store.adjustLife(EVENT_ID, SLOT_ID, 'player1', -1);
			await vi.advanceTimersByTimeAsync(300);
			life.resolve(commandResult(500, 2, state({ life1: 19, revealed: true })));
			await flushPromises();
			// Then the older reveal answer arrives.
			reveal.resolve(commandResult(500, 1, state({ life1: 20, revealed: true })));
			await flushPromises();

			expect(rendered().player1.lifeTotal).toBe(19);
			expect(rendered().player1.sideboardRevealed).toBe(true);
			expect(rendered().player2.sideboardRevealed).toBe(true);
			expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(2);
		});
	});
	describe('a late answer', () => {
		it('for an older sequence does not overwrite a newer Session state', () => {
			store.cacheSession(session(500, 5, state({ life1: 15 })));

			store.cacheSession(session(500, 3, state({ life1: 18 })));

			expect(rendered().player1.lifeTotal).toBe(15);
			expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(5);
		});

		it('for an older Session does not overwrite the newer one, however high its sequence', () => {
			store.cacheSession(session(600, 1, state({ life1: 40 })));

			store.cacheSession(session(500, 9, state({ life1: 3 })));

			expect(rendered().player1.lifeTotal).toBe(40);
			expect(store.sessionIdBySlotId.get(SLOT_ID)).toBe(600);
		});

		it('notifying an older Session is dropped, with no reload', async () => {
			store.cacheSession(session(600, 1, state({ life1: 40 })));

			await store.applyRemoteSessionEvent(notification(500, 9, state({ life1: 3 })));

			expect(rendered().player1.lifeTotal).toBe(40);
			expect(store.sessionIdBySlotId.get(SLOT_ID)).toBe(600);
			expect(mockRepo.ensureSession).not.toHaveBeenCalled();
		});

		it('carried by a Slot whose Session has since been replaced is refused', () => {
			store.cacheSession(session(600, 1, state({ life1: 40 })));

			const current = store.cacheSlotSession({ activeSession: session(500, 9, state({ life1: 3 })) });

			expect(current).toBe(false);
			expect(rendered().player1.lifeTotal).toBe(40);
		});
	});

	describe('overlapping state loads for one Slot', () => {
		it('resolve to the one issued later, whichever answers last', async () => {
			const earlier = deferred<FeatureMatchSessionResponse>();
			const later = deferred<FeatureMatchSessionResponse>();
			mockRepo.ensureSession.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);

			const first = store.loadState(EVENT_ID, SLOT_ID);
			const second = store.loadState(EVENT_ID, SLOT_ID);
			later.resolve(session(500, 4, state({ life1: 16 })));
			await second;
			earlier.resolve(session(500, 3, state({ life1: 17 })));
			await first;

			expect(rendered().player1.lifeTotal).toBe(16);
			expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(4);
		});
	});

	describe('settling an older command', () => {
		it('keeps a newer pending edit to the same Player', async () => {
			store.cacheSession(session(500, 0, state()));
			const cards = deferred<ReturnType<typeof commandResult>>();
			mockRepo.updatePlayerFeatureMatchState.mockReturnValueOnce(cards.promise);

			void store.setCardsKept(EVENT_ID, SLOT_ID, 'player1', 6);
			store.adjustLife(EVENT_ID, SLOT_ID, 'player1', -2);
			cards.resolve(commandResult(500, 1, state({ cardsKept1: 6 })));
			await flushPromises();

			expect(rendered().player1.lifeTotal).toBe(18);
			expect(rendered().player1.cardsKept).toBe(6);
		});

		it('across a Session epoch change renders the new Session, keeping a newer pending edit', async () => {
			store.cacheSession(session(500, 0, state()));
			const cards = deferred<ReturnType<typeof commandResult>>();
			mockRepo.updatePlayerFeatureMatchState.mockReturnValueOnce(cards.promise);

			void store.setCardsKept(EVENT_ID, SLOT_ID, 'player1', 6);
			store.adjustLife(EVENT_ID, SLOT_ID, 'player2', -2);
			// The Slot's Session is replaced while both are outstanding.
			await store.applyRemoteSessionEvent(notification(600, 1, state({ life1: 30, life2: 30 })));
			cards.resolve(commandResult(500, 1, state({ cardsKept1: 6 })));
			await flushPromises();

			expect(store.sessionIdBySlotId.get(SLOT_ID)).toBe(600);
			expect(rendered().player1.lifeTotal).toBe(30);
			expect(rendered().player1.cardsKept).toBe(state({ life1: 30 }).player1.cardsKept);
			expect(rendered().player2.lifeTotal).toBe(18);
		});
	});
});
