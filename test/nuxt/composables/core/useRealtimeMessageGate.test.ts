import { describe, expect, it, vi } from 'vitest';
import { useRealtimeMessageGate } from '~~/app/composables/core/useRealtimeMessageGate';

describe('useRealtimeMessageGate', () => {
	it('detects self-origin messages against a reactive connection id', () => {
		const connectionId = ref<string | undefined>('connection-1');
		const gate = useRealtimeMessageGate(connectionId);

		expect(gate.isSelfOrigin({ originConnectionId: 'connection-1' })).toBe(true);
		expect(gate.isSelfOrigin({ originConnectionId: 'connection-2' })).toBe(false);
		expect(gate.isSelfOrigin(undefined)).toBe(false);

		connectionId.value = 'connection-2';

		expect(gate.isSelfOrigin({ originConnectionId: 'connection-2' })).toBe(true);
	});

	it('skips self-origin messages and forwards accepted messages', () => {
		const handler = vi.fn();
		const accepted = useRealtimeMessageGate(ref('connection-1')).accept('player:updated', handler as never);

		accepted({ eventId: 1, originConnectionId: 'connection-1' } as never, undefined);
		accepted({ eventId: 1, originConnectionId: 'connection-2', player: { id: 2 } } as never, undefined);

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith({ eventId: 1, originConnectionId: 'connection-2', player: { id: 2 } });
	});

	it('logs async handler failures without throwing', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const accepted = useRealtimeMessageGate(ref('connection-1')).accept('player:updated', async () => {
			throw new Error('boom');
		});

		accepted({ eventId: 1, originConnectionId: 'connection-2' } as never, undefined);
		await Promise.resolve();

		expect(consoleSpy).toHaveBeenCalledWith('Failed to handle realtime message "player:updated":', expect.any(Error));
		consoleSpy.mockRestore();
	});
});
