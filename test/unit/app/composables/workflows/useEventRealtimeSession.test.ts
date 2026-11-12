import { beforeEach, describe, expect, it, vi } from 'vitest';

// The session's calls on the transport, which are its contract there: the room
// it enters and leaves, and the one handler map it registers. What a message or a
// resync does is tested through the real stores in `test/nuxt/modules/realtimeEventSession.test.ts`.
describe('useEventRealtimeSession', () => {
	const realtime = {
		connectionId: 'connection-1',
		tokenError: null as Error | null,
		setRoom: vi.fn(),
		onRoom: vi.fn(),
		offRoom: vi.fn(),
	};
	const eventStore = {
		eventId: 12,
		// The Event whose room this client joins: none on a live rendering of a Screen.
		roomEventId: 12,
		event: { id: 12 },
	};

	let watchCallback: ((room: string | null) => void) | undefined;
	let disposeCallback: (() => void) | undefined;

	async function startSession() {
		const { useEventRealtimeSession } = await import('~~/app/composables/workflows/useEventRealtimeSession');
		useEventRealtimeSession();
	}

	beforeEach(() => {
		vi.resetModules();
		watchCallback = undefined;
		disposeCallback = undefined;

		// The modules behind these reach the stores, which only a Nuxt app defines.
		vi.doMock('~/utils/eventStores', () => ({
			resetAllEventStores: vi.fn(),
		}));
		vi.doMock('~/modules/event-data/resync', () => ({
			eventDataResync: {
				resync: vi.fn(),
			},
		}));
		vi.doMock('~/composables/data/usePlayerDeckCache', () => ({
			clearPlayerDeckCache: vi.fn(),
		}));
		vi.stubGlobal('useRealtime', () => realtime);
		vi.stubGlobal('useEventStore', () => eventStore);
		// Read as the session and its handler map are built; none is called here.
		for (const name of [
			'useFeatureMatchAssignmentStore',
			'useBroadcastDeckListStore',
			'useMeleeDataRefresh',
			'useTournamentStructureRefresh',
		])
			vi.stubGlobal(name, () => ({}));
		vi.stubGlobal('useReconnectResync', vi.fn());
		vi.stubGlobal('watch', (source: () => unknown, callback: (value: never) => void, options?: { immediate?: boolean }) => {
			// The token wait's watcher, which reads a boolean; only the room's is followed.
			if (typeof source() === 'boolean')
				return;
			watchCallback = callback as typeof watchCallback;
			if (options?.immediate)
				callback(source() as never);
		});
		vi.stubGlobal('onScopeDispose', (callback: () => void) => {
			disposeCallback = callback;
		});
	});

	it('enters the active Event room, follows Event switches, and leaves on disposal', async () => {
		await startSession();
		expect(realtime.setRoom).toHaveBeenLastCalledWith('event:12');

		watchCallback?.('event:34');
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
});
