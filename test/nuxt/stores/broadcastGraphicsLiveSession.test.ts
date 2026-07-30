import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepository = {
	getSession: vi.fn(),
	sendCommand: vi.fn(),
};

vi.mock('~/composables/repositories/useBroadcastGraphicsLiveSessionRepository', () => ({
	useBroadcastGraphicsLiveSessionRepository: () => mockRepository,
}));

// Mirrors the real composable: failures land in the caller's error ref rather
// than propagating, so the store's own error handling is what these tests see.
mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: vi.fn(async (
		action: () => Promise<unknown>,
		options?: { loadingRef?: { value: boolean }; errorRef?: { value: string | null } },
	) => {
		if (options?.loadingRef)
			options.loadingRef.value = true;
		if (options?.errorRef)
			options.errorRef.value = null;
		try {
			return await action();
		}
		catch (e: unknown) {
			if (options?.errorRef)
				options.errorRef.value = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'An error occurred';
			return null;
		}
		finally {
			if (options?.loadingRef)
				options.loadingRef.value = false;
		}
	}),
}));

const EVENT_ID = 12;
const SCREEN_ID = 3;

function session(overrides: Partial<BroadcastGraphicsLiveSessionResponse> = {}): BroadcastGraphicsLiveSessionResponse {
	return {
		id: 55,
		eventId: EVENT_ID,
		screenId: SCREEN_ID,
		status: 'active',
		currentState: { playout: {} },
		sequence: 1,
		endedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides,
	};
}

function notification(
	overrides: Partial<MessageData<'broadcastGraphicsLiveSession:commandApplied'>> = {},
): MessageData<'broadcastGraphicsLiveSession:commandApplied'> {
	return {
		eventId: EVENT_ID,
		timestamp: 1_000,
		screenId: SCREEN_ID,
		sessionId: 55,
		sequence: 2,
		commandType: 'Take',
		currentState: { playout: { slate: { onAir: true } } },
		...overrides,
	} as MessageData<'broadcastGraphicsLiveSession:commandApplied'>;
}

describe('broadcastGraphicsLiveSessionStore', () => {
	let store: ReturnType<typeof useBroadcastGraphicsLiveSessionStore>;

	beforeEach(() => {
		store = useBroadcastGraphicsLiveSessionStore();
		store.$reset();
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session());
	});

	it('derives Graphic Playout State and the on-air stack from the loaded snapshot', async () => {
		mockRepository.getSession.mockResolvedValue(session({
			currentState: { playout: { slate: { onAir: true }, bug: { onAir: false } } },
		}));

		await store.loadSession(EVENT_ID, SCREEN_ID);

		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
		expect(store.playoutState(SCREEN_ID, 'bug')).toBe('off');
		expect(store.onAirGraphicIds(SCREEN_ID, [{ id: 'bug' }, { id: 'slate' }])).toEqual(['slate']);
	});

	it('reports every Broadcast Graphic off before any snapshot has loaded', () => {
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
		expect(store.onAirGraphicIds(SCREEN_ID, [{ id: 'slate' }])).toEqual([]);
	});

	it('sends a Take naming the loaded epoch, and keeps the returned snapshot', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true } } },
			session: session({ sequence: 2, currentState: { playout: { slate: { onAir: true } } } }),
		});

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.sendCommand).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID, 55, expect.objectContaining({
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}));
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
	});

	it('marks an Out as a Cut when the operator asked for one', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Out',
			currentState: { playout: {} },
			session: session({ sequence: 2 }),
		});

		await store.out(EVENT_ID, SCREEN_ID, 'slate', true);

		expect(mockRepository.sendCommand).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID, 55, expect.objectContaining({
			type: 'Out',
			payload: { graphicId: 'slate', cut: true },
		}));
	});

	it('names two separate operator intents distinctly, so neither suppresses the other', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true } } },
			session: session({ sequence: 2 }),
		});

		// Two presses are two intents. Sharing an id would make the receipt store
		// answer the second with the first one's outcome.
		await store.take(EVENT_ID, SCREEN_ID, 'slate');
		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		const [first, second] = mockRepository.sendCommand.mock.calls.map(call => call[3].commandId);
		expect(first).not.toBe(second);
	});

	it('reuses the command id when it restates one intent against the current epoch', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand
			.mockRejectedValueOnce({ statusCode: 409, message: 'Broadcast graphics live session has ended' })
			.mockResolvedValueOnce({
				screenId: SCREEN_ID,
				sessionId: 56,
				sequence: 2,
				commandType: 'Take',
				currentState: { playout: { slate: { onAir: true } } },
				session: session({ id: 56, sequence: 2 }),
			});
		mockRepository.getSession.mockResolvedValue(session({ id: 56, sequence: 1 }));

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		// One press is one intent however many times it has to be delivered, so the
		// retry carries the same command id. A fresh id would defeat the receipt
		// that exists to recognise it: were the first attempt to have landed after
		// all, the retry would be accepted a second time rather than answered with
		// the outcome it already had.
		const [first, retried] = mockRepository.sendCommand.mock.calls.map(call => call[3].commandId);
		expect(retried).toBe(first);
	});

	it('reloads and retries once when the epoch it cached has already ended', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();

		// The Screen left and re-entered Broadcast Graphics mode out of band, so the
		// epoch this client holds is gone.
		mockRepository.sendCommand
			.mockRejectedValueOnce({ statusCode: 409, message: 'Broadcast graphics live session has ended' })
			.mockResolvedValueOnce({
				screenId: SCREEN_ID,
				sessionId: 56,
				sequence: 2,
				commandType: 'Take',
				currentState: { playout: { slate: { onAir: true } } },
				session: session({ id: 56, sequence: 2, currentState: { playout: { slate: { onAir: true } } } }),
			});
		mockRepository.getSession.mockResolvedValue(session({ id: 56, sequence: 1 }));

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.getSession).toHaveBeenCalledOnce();
		expect(mockRepository.sendCommand.mock.calls.map(call => call[2])).toEqual([55, 56]);
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
		expect(store.error).toBeNull();
	});

	it('surfaces the failure when the retry against the current epoch also fails', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand.mockRejectedValue({ statusCode: 409, message: 'Screen is not in Broadcast Graphics mode' });
		mockRepository.getSession.mockResolvedValue(session({ id: 56 }));

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.sendCommand).toHaveBeenCalledTimes(2);
		expect(store.error).toMatch(/Broadcast Graphics mode/);
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
	});

	it('does not retry a failure that is not a conflict', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand.mockRejectedValue({ statusCode: 500, message: 'Internal Server Error' });

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.sendCommand).toHaveBeenCalledOnce();
		expect(mockRepository.getSession).not.toHaveBeenCalled();
		expect(store.error).toBe('Internal Server Error');
	});

	it('reports a Broadcast Graphic as pending only while its own action is in flight', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		let release: (value: unknown) => void = () => {};
		mockRepository.sendCommand.mockImplementation(() => new Promise((resolve) => {
			release = resolve;
		}));

		const inFlight = store.take(EVENT_ID, SCREEN_ID, 'slate');
		await Promise.resolve();

		expect(store.isPending(SCREEN_ID, 'slate')).toBe(true);
		expect(store.isPending(SCREEN_ID, 'bug')).toBe(false);

		release({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true } } },
			session: session({ sequence: 2, currentState: { playout: { slate: { onAir: true } } } }),
		});
		await inFlight;

		expect(store.isPending(SCREEN_ID, 'slate')).toBe(false);
	});

	it('clears the pending marker even when the action fails', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockRejectedValue({ statusCode: 500, message: 'boom' });

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(store.isPending(SCREEN_ID, 'slate')).toBe(false);
	});

	it('follows a notification that continues the sequence it already holds', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();

		await store.applyRemoteCommand(notification());

		expect(mockRepository.getSession).not.toHaveBeenCalled();
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
	});

	it('ignores a notification the authoritative sequence has already passed', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		await store.applyRemoteCommand(notification());
		vi.clearAllMocks();

		await store.applyRemoteCommand(notification({
			sequence: 2,
			currentState: { playout: { slate: { onAir: false } } },
		}));

		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
	});

	it('reloads the authoritative snapshot when it has fallen behind the sequence', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session({
			sequence: 9,
			currentState: { playout: { bug: { onAir: true } } },
		}));

		// A disconnect swallowed sequences 2 through 8: the notification is not
		// authority, so the snapshot is what resolves the gap.
		await store.applyRemoteCommand(notification({ sequence: 9 }));

		expect(mockRepository.getSession).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID);
		expect(store.playoutState(SCREEN_ID, 'bug')).toBe('on-air');
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
	});

	it('reloads rather than trusting a notification from a different Live Session epoch', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session({ id: 56, sequence: 1 }));

		await store.applyRemoteCommand(notification({ sessionId: 56, sequence: 2 }));

		expect(mockRepository.getSession).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID);
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
	});

	it('reloads when a notification arrives for a Screen it has never loaded', async () => {
		await store.applyRemoteCommand(notification());

		expect(mockRepository.getSession).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID);
	});
});
