import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastCallTo } from '~~/test/helpers/lastCallTo';

type RealtimeHandlerMap = Record<string, (data: Record<string, unknown>) => void>;
type FakeStore = Record<string, Mock>;

/** A store whose every method is a resolving mock, so only the methods a test reads are named. */
function fakeStore(state: Record<string, unknown> = {}): FakeStore {
	return new Proxy(state, {
		get: (target, key: string) => (target[key] ??= vi.fn().mockResolvedValue(undefined)),
	}) as FakeStore;
}

// Exhaustive routing of every Event-room message is a compile-time check
// (`createEventRealtimeHandlers` satisfies `EventRoomHandlers`), and each store's
// handling is tested through the real handlers in `test/nuxt/stores`.
describe('useEventRealtimeSession', () => {
	const mockResetAllEventStores = vi.fn();
	const mockNavigateTo = vi.fn();
	const mockClearPlayerDeckCache = vi.fn();
	const useReconnectResync = vi.fn();
	const eventDataResync = {
		resync: vi.fn(),
	};
	const refreshMeleeStructureData = vi.fn();
	const refreshAfterMeleeReset = vi.fn();
	const realtime = {
		connectionId: 'connection-1',
		tokenError: null as Error | null,
		setRoom: vi.fn(),
		onRoom: vi.fn(),
		offRoom: vi.fn(),
	};
	const eventState = {
		eventId: 12 as number | null,
		event: { id: 12 },
	};
	const eventStore = fakeStore(eventState);
	const stores: Record<string, FakeStore> = {
		useEventStore: eventStore,
		usePlayerStore: fakeStore(),
		usePlayerDeckStore: fakeStore(),
		useMetagameStore: fakeStore(),
		useArchetypeStore: fakeStore(),
		usePlayerListStore: fakeStore(),
		usePhaseStore: fakeStore(),
		useRoundStore: fakeStore(),
		useMatchStore: fakeStore(),
		useFeatureMatchStore: fakeStore(),
		useFeatureMatchStateStore: fakeStore(),
		useFeatureMatchAssignmentStore: fakeStore(),
		useBroadcastDeckListStore: fakeStore(),
		useBroadcastGraphicsLiveSessionStore: fakeStore(),
		useScreenStore: fakeStore(),
		useCardStore: fakeStore(),
	};
	const { usePlayerStore: playerStore, useMetagameStore: metagameStore, useFeatureMatchStore: featureMatchStore } = stores;

	let watchCallback: ((eventId: number | null) => void) | undefined;
	let tokenWaitCallback: ((waiting: boolean, wasWaiting: boolean) => void) | undefined;
	let disposeCallback: (() => void) | undefined;

	async function startSession(): Promise<RealtimeHandlerMap> {
		const { useEventRealtimeSession } = await import('~~/app/composables/workflows/useEventRealtimeSession');
		useEventRealtimeSession();
		const [, handlers] = lastCallTo(realtime.onRoom, 'event-session');
		return handlers as RealtimeHandlerMap;
	}

	const message = { eventId: 12, originConnectionId: 'connection-2' };

	beforeEach(() => {
		vi.resetModules();
		eventState.eventId = 12;
		watchCallback = undefined;
		tokenWaitCallback = undefined;
		disposeCallback = undefined;

		vi.doMock('~/utils/eventStores', () => ({ resetAllEventStores: mockResetAllEventStores }));
		vi.doMock('~/modules/event-data/resync', () => ({ eventDataResync }));
		vi.doMock('~/composables/data/usePlayerDeckCache', () => ({ clearPlayerDeckCache: mockClearPlayerDeckCache }));
		vi.stubGlobal('useRealtime', () => realtime);
		for (const [name, store] of Object.entries(stores))
			vi.stubGlobal(name, () => store);
		vi.stubGlobal('useMeleeDataRefresh', () => ({ refreshMeleeStructureData, refreshAfterMeleeReset }));
		vi.stubGlobal('useReconnectResync', useReconnectResync);
		vi.stubGlobal('navigateTo', mockNavigateTo);
		vi.stubGlobal('watch', (source: () => unknown, callback: (value: never, previous: never) => void, options?: { immediate?: boolean }) => {
			if (typeof source() === 'boolean') {
				tokenWaitCallback = callback as typeof tokenWaitCallback;
				return;
			}
			watchCallback = callback as typeof watchCallback;
			if (options?.immediate)
				callback(source() as never, undefined as never);
		});
		vi.stubGlobal('onScopeDispose', (callback: () => void) => {
			disposeCallback = callback;
		});
	});

	it('enters the active Event room, follows Event switches, and leaves on disposal', async () => {
		await startSession();
		expect(realtime.setRoom).toHaveBeenLastCalledWith('event:12');

		watchCallback?.(34);
		expect(realtime.setRoom).toHaveBeenLastCalledWith('event:34');

		disposeCallback?.();
		expect(realtime.offRoom).toHaveBeenCalledWith('event-session');
		expect(realtime.setRoom).toHaveBeenLastCalledWith(null);
	});

	it('starts once per scope, and again after disposal', async () => {
		const { useEventRealtimeSession } = await import('~~/app/composables/workflows/useEventRealtimeSession');

		useEventRealtimeSession();
		useEventRealtimeSession();
		expect(realtime.onRoom).toHaveBeenCalledOnce();

		disposeCallback?.();
		useEventRealtimeSession();
		expect(realtime.onRoom).toHaveBeenCalledTimes(2);
	});

	it.each([
		'player:updated',
		'playerDeck:cardsResolved',
		'archetype:keyCardsUpdated',
		'playerList:membersChanged',
	])(
		'invalidates the metagame on %s',
		async (type) => {
			const handlers = await startSession();

			handlers[type]!(message);

			expect(metagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		},
	);

	it('reloads Players, Deck Lists and Feature Matches after a Melee Deck List sync', async () => {
		const handlers = await startSession();

		handlers['melee:decklistsSynced']!(message);

		await vi.waitFor(() => {
			expect(metagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(playerStore.loadPlayersByEventId).toHaveBeenCalledWith(12);
			expect(stores.usePlayerDeckStore!.loadByEventId).toHaveBeenCalledWith(12);
			expect(featureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(12);
		});
	});

	it('refreshes structure after a Melee structure sync and a Melee reset', async () => {
		const handlers = await startSession();

		handlers['melee:structureSynced']!({ ...message, phaseCount: 2, roundCount: 8 });
		handlers['melee:dataReset']!({ ...message, reason: 'event-changed' });

		await vi.waitFor(() => {
			expect(refreshMeleeStructureData).toHaveBeenCalledWith(12);
			expect(refreshAfterMeleeReset).toHaveBeenCalledWith(12);
		});
	});

	it('reloads Rounds, refreshed Matches and Feature Matches after a Melee Round sync', async () => {
		const handlers = await startSession();
		const roundMessage = {
			...message,
			roundId: 3,
			matchCount: 4,
			created: 2,
			updated: 1,
			staleDeleted: 1,
		};

		handlers['melee:roundSynced']!(roundMessage);

		await vi.waitFor(() => {
			expect(stores.useRoundStore!.loadRoundsByEventId).toHaveBeenCalledWith(12);
			expect(stores.useMatchStore!.applyRemoteMatchesRefreshed).toHaveBeenCalledWith(roundMessage);
			expect(featureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(12);
		});
	});

	it('resets Event state and navigates home when the active Event is deleted', async () => {
		const handlers = await startSession();

		handlers['event:deleted']!({ eventId: 12 });

		expect(realtime.setRoom).toHaveBeenLastCalledWith(null);
		expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		expect(mockNavigateTo).toHaveBeenCalledWith('/');
	});

	it('logs a handler that throws instead of breaking the room', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = new Error('player update failed');
		playerStore.applyRemoteUpdated!.mockImplementationOnce(() => {
			throw error;
		});
		const handlers = await startSession();

		handlers['player:updated']!(message);

		expect(consoleSpy).toHaveBeenCalledWith('Failed to handle realtime message "player:updated":', error);
	});

	describe('resync', () => {
		function expectFullResync() {
			expect(mockClearPlayerDeckCache).toHaveBeenCalledOnce();
			expect(stores.useFeatureMatchAssignmentStore!.reloadConsumedRounds).toHaveBeenCalledOnce();
			expect(stores.useBroadcastDeckListStore!.reloadAuthoritativeState).toHaveBeenCalledOnce();
			expect(eventDataResync.resync).toHaveBeenCalledOnce();
		}

		it('reloads Assignments, Broadcast Deck Lists, Event Data and the Deck List cache on reconnect', async () => {
			await startSession();
			const [resync, eventId] = useReconnectResync.mock.calls[0]!;

			expect(eventId()).toBe(12);
			resync();

			expectFullResync();
		});

		it('runs once its subscriptions stop waiting on a token', async () => {
			await startSession();

			tokenWaitCallback?.(true, false);
			expect(eventDataResync.resync).not.toHaveBeenCalled();
			tokenWaitCallback?.(false, true);

			expectFullResync();
		});
	});
});
