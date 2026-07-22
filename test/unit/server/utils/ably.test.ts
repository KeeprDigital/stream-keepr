import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublish = vi.fn();
const mockGetChannel = vi.fn(() => ({ publish: mockPublish }));

class MockAblyRest {
	channels = { get: mockGetChannel };
	static callCount = 0;
	static lastKey: string | undefined;
	constructor(key: string) {
		MockAblyRest.callCount++;
		MockAblyRest.lastKey = key;
	}

	static reset() {
		MockAblyRest.callCount = 0;
		MockAblyRest.lastKey = undefined;
	}
}

vi.mock('ably', () => ({
	default: { Rest: MockAblyRest },
}));

vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ ablyApiKey: 'test-key' })));
vi.stubGlobal('getHeader', vi.fn());

// ──────────────── getOriginConnectionId ────────────────

describe('getOriginConnectionId', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.mocked(getHeader).mockReset();
	});

	it('extracts x-realtime-connection-id header', async () => {
		vi.mocked(getHeader).mockReturnValue('conn-abc-123');
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		const mockEvent = {} as any;
		expect(getOriginConnectionId(mockEvent)).toBe('conn-abc-123');
		expect(getHeader).toHaveBeenCalledWith(mockEvent, 'x-realtime-connection-id');
	});
});

// ──────────────── getAblyClient ────────────────

describe('getAblyClient', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('returns Ably.Rest instance when configured', async () => {
		const { getAblyClient } = await import('~~/server/utils/ably');
		const client = getAblyClient();
		expect(MockAblyRest.lastKey).toBe('test-key');
		expect(client).toBeDefined();
		expect(client.channels).toBeDefined();
	});

	it('returns same instance on subsequent calls', async () => {
		const { getAblyClient } = await import('~~/server/utils/ably');
		const client1 = getAblyClient();
		const client2 = getAblyClient();
		expect(client1).toBe(client2);
		expect(MockAblyRest.callCount).toBe(1);
	});
});

// ──────────────── publishMessage ────────────────

describe('publishMessage', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		mockGetChannel.mockClear();
		mockPublish.mockClear();
		mockPublish.mockResolvedValue(undefined);
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('calls channel.publish with correct message type', async () => {
		const { publishMessage } = await import('~~/server/utils/ably');
		await publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123');
		expect(mockGetChannel).toHaveBeenCalledWith('event:1');
		expect(mockPublish).toHaveBeenCalledWith(
			'event:deleted',
			expect.objectContaining({ eventId: 1, originConnectionId: 'conn-123' }),
		);
	});

	it('does not turn missing realtime configuration into a command failure', async () => {
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledOnce();
		expect(mockPublish).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('preserves missing realtime configuration failures for strict publications', async () => {
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
		const { publishMessageStrict } = await import('~~/server/utils/ably');

		await expect(
			publishMessageStrict(1, 'melee:playersSynced', { playerCount: 2 }, 'conn-123'),
		).rejects.toThrow('Ably server API key is not configured');
	});
});

// ──────────────── publishScreenCommand ────────────────

describe('publishScreenCommand', () => {
	beforeEach(() => {
		vi.resetModules();
		MockAblyRest.reset();
		mockGetChannel.mockClear();
		mockPublish.mockClear();
		mockPublish.mockResolvedValue(undefined);
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('publishes screen commands to the screen channel', async () => {
		const { publishScreenCommand } = await import('~~/server/utils/ably');

		await publishScreenCommand(1, 10, 'identify');

		expect(mockGetChannel).toHaveBeenCalledWith('screen:1:10');
		expect(mockPublish).toHaveBeenCalledWith(
			'screen:command:identify',
			expect.objectContaining({
				eventId: 1,
				screenId: 10,
				timestamp: expect.any(Number),
			}),
		);
	});
});
