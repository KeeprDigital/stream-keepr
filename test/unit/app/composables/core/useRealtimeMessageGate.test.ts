import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
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
		accepted({
			eventId: 1,
			originConnectionId: 'connection-2',
			player: { id: 2 },
		} as never, undefined);

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith({
			eventId: 1,
			originConnectionId: 'connection-2',
			player: { id: 2 },
		});
	});

	// A handler's failure is logged and goes no further, so its channel goes on delivering.
	it.each([
		[
			'throws',
			() => {
				throw new Error('boom');
			},
		],
		[
			'rejects',
			async () => {
				throw new Error('boom');
			},
		],
	])('logs a handler that %s, and hands it the next message', async (_, fail) => {
		const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const handled: unknown[] = [];
		const accepted = useRealtimeMessageGate(ref('connection-1')).accept('player:updated', (data) => {
			handled.push(data);
			if (handled.length === 1)
				return fail();
		});
		const first = { eventId: 1, originConnectionId: 'connection-2' } as never;
		const second = { eventId: 2, originConnectionId: 'connection-2' } as never;

		expect(() => accepted(first, undefined)).not.toThrow();
		await Promise.resolve();
		accepted(second, undefined);

		expect(logged.mock.calls).toEqual([
			[
				'Failed to handle realtime message "player:updated":',
				expect.any(Error),
			],
		]);
		expect(handled).toEqual([first, second]);
	});
});
