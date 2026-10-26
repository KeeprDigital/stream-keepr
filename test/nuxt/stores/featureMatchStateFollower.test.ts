import type { FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

/*
 * The Feature Match Session client following its aggregate through the Live State
 * Follower (#591). Like the batch-clobber suite, this drives the real store, the real
 * optimistic-state module and the real debounce, mocking only the network: answers
 * arrive in whatever order each test resolves them, which is the whole subject.
 */

const mockRepo = {
	ensureSession: vi.fn(),
	updateState: vi.fn(),
	updatePlayerFeatureMatchState: vi.fn(),
	recordGameWin: vi.fn(),
};

vi.mock('~/modules/feature-match-session/client', () => ({
	useFeatureMatchSessionClient: () => mockRepo,
}));

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => 1000000,
}));

const EVENT_ID = 1;
const SLOT_ID = 100;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function flushPromises() {
	for (let i = 0; i < 6; i++)
		await Promise.resolve();
}

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

function state(player1: { life?: number; revealed?: boolean } = {}, player2: { life?: number; revealed?: boolean } = {}, extra: Partial<FeatureMatchState> = {}) {
	return createMockFeatureMatchState({
		player1: {
			lifeTotal: player1.life ?? 20,
			gameWins: 0,
			counters: [],
			sideboardRevealed: player1.revealed ?? false,
		},
		player2: {
			lifeTotal: player2.life ?? 20,
			gameWins: 0,
			counters: [],
			sideboardRevealed: player2.revealed ?? false,
		},
		...extra,
	});
}

function session(currentState: FeatureMatchState, sequence: number, id = 500): FeatureMatchSessionResponse {
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

function commandResult(currentState: FeatureMatchState, sequence: number, id = 500) {
	return {
		featureMatchState: currentState,
		session: session(currentState, sequence, id),
		sequence,
	};
}

function eventApplied(currentState: FeatureMatchState, sequence: number, sessionId = 500): MessageData<'featureMatchSession:eventApplied'> {
	return {
		eventId: EVENT_ID,
		timestamp: Date.now(),
		slotId: SLOT_ID,
		sessionId,
		sequence,
		eventType: 'SetTurnNumber',
		sourceSnapshot: sourceSnapshot(),
		currentState,
	};
}

describe('the Feature Match Session client follows its aggregate', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;

	function rendered() {
		return store.featureMatchStates.get(SLOT_ID)!;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		store = useFeatureMatchStateStore();
		store.$reset();
		vi.clearAllMocks();
		store.cacheSession(session(state(), 0));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('keeps a newer life total when an older reveal answer for the same Player lands last (F04)', async () => {
		const reveal = deferred<ReturnType<typeof commandResult>>();
		mockRepo.updateState.mockReturnValue(reveal.promise);
		mockRepo.updatePlayerFeatureMatchState.mockResolvedValue(
			commandResult(state({ life: 19, revealed: true }, { revealed: true }), 2),
		);

		// Show sideboards is accepted at sequence 1, but its answer is delayed.
		const revealing = store.setSideboardRevealed(EVENT_ID, SLOT_ID, true);
		// A Player 1 life decrement is accepted at sequence 2 and answers first.
		store.adjustLife(EVENT_ID, SLOT_ID, 'player1', -1);
		vi.advanceTimersByTime(400);
		await flushPromises();
		expect(rendered().player1.lifeTotal).toBe(19);

		// The older reveal answer arrives last.
		reveal.resolve(commandResult(state({ life: 20, revealed: true }, { revealed: true }), 1));
		await revealing;
		await flushPromises();

		expect(rendered().player1).toMatchObject({ lifeTotal: 19, sideboardRevealed: true });
		expect(rendered().player2).toMatchObject({ sideboardRevealed: true });
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(2);
	});

	it('keeps a pending life edit while an older command settles', async () => {
		const reveal = deferred<ReturnType<typeof commandResult>>();
		mockRepo.updateState.mockReturnValue(reveal.promise);

		const revealing = store.setSideboardRevealed(EVENT_ID, SLOT_ID, true);
		// The tap is still inside its debounce window: only this client knows it.
		store.adjustLife(EVENT_ID, SLOT_ID, 'player1', -1);

		reveal.resolve(commandResult(state({ revealed: true }, { revealed: true }), 1));
		await revealing;
		await flushPromises();

		expect(rendered().player1).toMatchObject({ lifeTotal: 19, sideboardRevealed: true });
		expect(rendered().player2).toMatchObject({ sideboardRevealed: true });
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(1);
	});

	it('settles an older Session\'s answer from the newer Session, keeping a pending edit', async () => {
		const activePlayer = deferred<ReturnType<typeof commandResult>>();
		mockRepo.updateState.mockReturnValue(activePlayer.promise);

		const setting = store.setActivePlayer(EVENT_ID, SLOT_ID, 'player2');
		store.adjustLife(EVENT_ID, SLOT_ID, 'player1', -1);

		// The Slot moves on to a new Session while both are outstanding.
		await store.applyRemoteSessionEvent(eventApplied(state({ life: 20 }, { life: 7 }, { activePlayer: 'player1' }), 1, 600));
		// The old Session's answer arrives late.
		activePlayer.resolve(commandResult(state({}, {}, { activePlayer: 'player2' }), 3, 500));
		await setting;
		await flushPromises();

		expect(store.sessionIdBySlotId.get(SLOT_ID)).toBe(600);
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(1);
		expect(rendered().activePlayer).toBe('player1');
		expect(rendered().player1.lifeTotal).toBe(19);
		expect(rendered().player2.lifeTotal).toBe(7);
	});

	it('never lets a game result answer for an older sequence overwrite a newer one', async () => {
		await store.applyRemoteSessionEvent(eventApplied(state({}, {}, { turnNumber: 4 }), 1));
		await store.applyRemoteSessionEvent(eventApplied(state({}, {}, { turnNumber: 5 }), 2));
		mockRepo.recordGameWin.mockResolvedValue(commandResult(state({}, {}, { turnNumber: 3 }), 1));

		await store.recordGameWin(EVENT_ID, SLOT_ID, 'player1');

		expect(rendered().turnNumber).toBe(5);
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(2);
	});

	it('never lets a message from an older Session replace a newer one', async () => {
		await store.applyRemoteSessionEvent(eventApplied(state({ life: 13 }), 1, 600));

		await store.applyRemoteSessionEvent(eventApplied(state({ life: 2 }), 9, 500));

		expect(store.sessionIdBySlotId.get(SLOT_ID)).toBe(600);
		expect(rendered().player1.lifeTotal).toBe(13);
		expect(mockRepo.ensureSession).not.toHaveBeenCalled();
	});

	it('never lets a Slot carrying an older sequence move its Session backwards', async () => {
		await store.applyRemoteSessionEvent(eventApplied(state({ life: 18 }), 1));

		store.offerSlotSession({
			id: SLOT_ID,
			activeSession: session(state({ life: 20 }), 0),
		});

		expect(rendered().player1.lifeTotal).toBe(18);
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(1);
	});

	it('lets a load answer newer than a Slot read in the meantime', async () => {
		const loading = deferred<FeatureMatchSessionResponse>();
		mockRepo.ensureSession.mockReturnValueOnce(loading.promise);

		const load = store.loadState(EVENT_ID, SLOT_ID);
		store.offerSlotSession({
			id: SLOT_ID,
			activeSession: session(state({ life: 18 }), 4),
		});
		loading.resolve(session(state({ life: 16 }), 5));
		await load;

		expect(rendered().player1.lifeTotal).toBe(16);
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(5);
	});

	it('resolves two overlapping loads for one Slot to the later one', async () => {
		const first = deferred<FeatureMatchSessionResponse>();
		const second = deferred<FeatureMatchSessionResponse>();
		mockRepo.ensureSession.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

		const earlier = store.loadState(EVENT_ID, SLOT_ID);
		const later = store.loadState(EVENT_ID, SLOT_ID);
		second.resolve(session(state({ life: 11 }), 6));
		await later;
		first.resolve(session(state({ life: 15 }), 5));
		await earlier;

		expect(rendered().player1.lifeTotal).toBe(11);
		expect(store.sessionSequenceBySlotId.get(SLOT_ID)).toBe(6);
	});
});
