import type { BroadcastGraphicsSessionResponse } from '~~/shared/types/broadcastGraphicsSession';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepository = {
	getSession: vi.fn(),
	sendCommand: vi.fn(),
};

vi.mock('~/composables/repositories/useBroadcastGraphicsSessionRepository', () => ({
	useBroadcastGraphicsSessionRepository: () => mockRepository,
}));

mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: vi.fn(async (action: () => Promise<unknown>) => await action()),
}));

const EVENT_ID = 12;
const SCREEN_ID = 3;

function session(overrides: Partial<BroadcastGraphicsSessionResponse> = {}): BroadcastGraphicsSessionResponse {
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
	overrides: Partial<MessageData<'broadcastGraphicsSession:commandApplied'>> = {},
): MessageData<'broadcastGraphicsSession:commandApplied'> {
	return {
		eventId: EVENT_ID,
		timestamp: 1_000,
		screenId: SCREEN_ID,
		sessionId: 55,
		sequence: 2,
		commandType: 'Take',
		currentState: { playout: { slate: { onAir: true } } },
		...overrides,
	} as MessageData<'broadcastGraphicsSession:commandApplied'>;
}

describe('broadcastGraphicsSessionStore', () => {
	let store: ReturnType<typeof useBroadcastGraphicsSessionStore>;

	beforeEach(() => {
		store = useBroadcastGraphicsSessionStore();
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

	it('names each command distinctly so a retry is the only thing a receipt suppresses', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true } } },
			session: session({ sequence: 2 }),
		});

		await store.take(EVENT_ID, SCREEN_ID, 'slate');
		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		const [first, second] = mockRepository.sendCommand.mock.calls.map(call => call[3].commandId);
		expect(first).not.toBe(second);
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
