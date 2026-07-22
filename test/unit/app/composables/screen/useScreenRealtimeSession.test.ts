import { beforeEach, describe, expect, it, vi } from 'vitest';

type ChannelHandler = (data: Record<string, unknown>) => void;

describe('useScreenRealtimeSession', () => {
	const unsubscribers = {
		refresh: vi.fn(),
		identify: vi.fn(),
		debug: vi.fn(),
	};
	const handlers = new Map<string, ChannelHandler>();
	const realtime = {
		onChannel: vi.fn((channel: string, type: string, handler: ChannelHandler) => {
			handlers.set(`${channel}:${type}`, handler);
			if (type === 'screen:command:refresh')
				return unsubscribers.refresh;
			if (type === 'screen:command:identify')
				return unsubscribers.identify;
			return unsubscribers.debug;
		}),
		enterPresence: vi.fn(),
		leavePresence: vi.fn(),
	};
	const callbacks = {
		onRefresh: vi.fn(),
		onIdentify: vi.fn(),
		onDebug: vi.fn(),
	};
	let disposeCallback: (() => void) | undefined;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		handlers.clear();
		disposeCallback = undefined;
		realtime.enterPresence.mockResolvedValue(undefined);
		realtime.leavePresence.mockResolvedValue(undefined);

		vi.stubGlobal('useRealtime', () => realtime);
		vi.stubGlobal('ref', (value: unknown) => ({ value }));
		vi.stubGlobal('onScopeDispose', (callback: () => void) => {
			disposeCallback = callback;
		});
	});

	async function createSession() {
		const { useScreenRealtimeSession } = await import('~~/app/composables/screen/useScreenRealtimeSession');

		return useScreenRealtimeSession({
			...callbacks,
			getPresenceData: (_eventId: number, screenId: number) => ({
				screenId,
				connectedAt: 123,
			}),
		});
	}

	it('subscribes to screen command types and enters presence on the screen channel', async () => {
		const session = await createSession();

		await session.start(1, 10);

		expect(realtime.onChannel).toHaveBeenCalledWith('screen:1:10', 'screen:command:refresh', expect.any(Function));
		expect(realtime.onChannel).toHaveBeenCalledWith('screen:1:10', 'screen:command:identify', expect.any(Function));
		expect(realtime.onChannel).toHaveBeenCalledWith('screen:1:10', 'screen:command:debug', expect.any(Function));
		expect(realtime.enterPresence).toHaveBeenCalledWith('screen:1:10', {
			screenId: 10,
			connectedAt: 123,
		});
	});

	it('unsubscribes command handlers and leaves presence when stopped', async () => {
		const session = await createSession();
		await session.start(1, 10);

		await session.stop();

		expect(unsubscribers.refresh).toHaveBeenCalledOnce();
		expect(unsubscribers.identify).toHaveBeenCalledOnce();
		expect(unsubscribers.debug).toHaveBeenCalledOnce();
		expect(realtime.leavePresence).toHaveBeenCalledWith('screen:1:10');
	});

	it('cleans up on scope disposal', async () => {
		const session = await createSession();
		await session.start(1, 10);

		disposeCallback?.();
		await Promise.resolve();

		expect(unsubscribers.refresh).toHaveBeenCalledOnce();
		expect(unsubscribers.identify).toHaveBeenCalledOnce();
		expect(unsubscribers.debug).toHaveBeenCalledOnce();
		expect(realtime.leavePresence).toHaveBeenCalledWith('screen:1:10');
	});
});
