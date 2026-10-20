import type { EffectScope } from 'vue';
import type { ScreenModeDependencies, ScreenModeFreshnessTransport } from '~/modules/screen-mode/freshness';
import type { RealtimeTransport } from '~/types/realtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';
import { SCREEN_MODE_DEGRADED_REFETCH_MS, useScreenModeFreshness } from '~/modules/screen-mode/freshness';

/**
 * Screen Mode Data Freshness, driven through a stand-in transport: a mode names
 * what it reads and the Event Data it depends on, and the module keeps that read
 * current — on load, on a relevant message, while realtime is degraded, and on
 * coming back from a disconnection.
 */

interface Held {
	ids: number[];
	label: string;
}

type Handler = (message: Record<string, unknown>) => void;

function fakeTransport() {
	const handlers = new Map<string, Set<Handler>>();
	const continuity = createContinuitySignal();
	const transport = reactive({
		connectionState: 'connected' as RealtimeTransport['connectionState'],
		tokenError: null as Error | null,
		onChannel: vi.fn((channel: string, type: string, handler: Handler) => {
			const key = `${channel}|${type}`;
			if (!handlers.has(key))
				handlers.set(key, new Set());
			handlers.get(key)!.add(handler);
			return () => handlers.get(key)!.delete(handler);
		}),
		onContinuityLost: continuity.onContinuityLost,
	});
	return {
		transport,
		deliver(eventId: number, type: string, payload: Record<string, unknown>) {
			for (const handler of handlers.get(`event:${eventId}|${type}`) ?? [])
				handler({ eventId, ...payload });
		},
		/** The Event channel attached again having lost continuity. */
		reattach: (eventId: number) => continuity.reattach(`event:${eventId}`),
		listeners: () => [...handlers.values()].reduce((total, set) => total + set.size, 0),
	};
}

const scopes: EffectScope[] = [];

function harness(dependsOn: ScreenModeDependencies<Held> = {}) {
	const realtime = fakeTransport();
	const eventId = ref<number | null>(1);
	const selection = ref<number | null>(7);
	const read = vi.fn(async (): Promise<Held> => ({ ids: [selection.value!], label: `read ${read.mock.calls.length}` }));
	const scope = effectScope();
	scopes.push(scope);
	const freshness = scope.run(() => useScreenModeFreshness<Held>({
		eventId,
		source: () => selection.value === null ? null : String(selection.value),
		read,
		initialData: { ids: [], label: 'none' },
		errorMessage: 'Failed to read',
		dependsOn,
		realtime: realtime.transport as unknown as ScreenModeFreshnessTransport,
	}))!;
	return { ...realtime, eventId, selection, read, freshness, scope };
}

describe('useScreenModeFreshness', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	describe('load', () => {
		it('reads what the mode selects, and re-reads when the selection changes', async () => {
			const { read, selection, freshness } = harness();
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
			expect(freshness.data.value).toEqual({ ids: [7], label: 'read 1' });

			selection.value = 9;
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.ids).toEqual([9]);
		});

		it('reads nothing and holds nothing while the mode selects nothing', async () => {
			const { read, selection, freshness } = harness();
			await flushPromises();

			selection.value = null;
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
			expect(freshness.data.value).toEqual({ ids: [], label: 'none' });
		});
	});

	describe('live-follow', () => {
		it('re-reads on a message the mode depends on that touches what it holds', async () => {
			const { read, deliver, freshness } = harness({
				'match:deleted': (message, held) => held.ids.includes(message.matchId),
			});
			await flushPromises();

			deliver(1, 'match:deleted', { matchId: 7 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('read 2');
		});

		it('ignores a message that does not touch what it holds, and types it does not depend on', async () => {
			const { read, deliver } = harness({
				'match:deleted': (message, held) => held.ids.includes(message.matchId),
			});
			await flushPromises();

			deliver(1, 'match:deleted', { matchId: 99 });
			deliver(1, 'round:deleted', { roundId: 7 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('re-reads on every message of a type it depends on unconditionally', async () => {
			const { read, deliver } = harness({ 'phase:deleted': true });
			await flushPromises();

			deliver(1, 'phase:deleted', { phaseId: 3 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('re-reads after a dependency message heard while a read is in flight', async () => {
			// What is held cannot judge a message the in-flight read may predate.
			const { read, deliver } = harness({
				'match:deleted': (message, held) => held.ids.includes(message.matchId),
			});

			deliver(1, 'match:deleted', { matchId: 99 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('coalesces a burst of messages into one read', async () => {
			const { read, deliver } = harness({ 'phase:deleted': true });
			await flushPromises();

			deliver(1, 'phase:deleted', { phaseId: 3 });
			deliver(1, 'phase:deleted', { phaseId: 4 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('follows the Event it is on, and stops listening when disposed', async () => {
			const { read, deliver, eventId, listeners, scope } = harness({ 'phase:deleted': true });
			await flushPromises();

			eventId.value = 2;
			await flushPromises();
			deliver(1, 'phase:deleted', { phaseId: 3 });
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(1);

			deliver(2, 'phase:deleted', { phaseId: 3 });
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);

			scope.stop();
			expect(listeners()).toBe(0);
		});
	});

	describe('degraded refetch', () => {
		it('re-reads on a cadence while its Event\'s subscriptions cannot attach, and resyncs once they do', async () => {
			vi.useFakeTimers();
			const { read, transport } = harness();
			await flushPromises();

			transport.tokenError = new Error('mint failed');
			await nextTick();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS);
			expect(read).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS);
			expect(read).toHaveBeenCalledTimes(3);

			// Recovered: whatever was published while nothing listened is gone, so
			// recovery is itself a reason to re-read; the cadence then stops.
			transport.tokenError = null;
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(4);
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS * 3);
			expect(read).toHaveBeenCalledTimes(4);
		});

		it('re-reads on a cadence while disconnected, and holds what it shows when a read fails', async () => {
			vi.useFakeTimers();
			const { read, transport, freshness } = harness();
			await flushPromises();

			transport.connectionState = 'suspended';
			read.mockRejectedValueOnce(new Error('offline'));
			await nextTick();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS);

			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('read 1');
			expect(freshness.error.value).toBeNull();
		});

		it('reads nothing on the cadence while the mode selects nothing', async () => {
			vi.useFakeTimers();
			const { read, transport, selection } = harness();
			await flushPromises();

			selection.value = null;
			transport.tokenError = new Error('mint failed');
			await nextTick();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('stops its cadence when disposed', async () => {
			vi.useFakeTimers();
			const { read, transport, scope } = harness();
			await flushPromises();

			transport.tokenError = new Error('mint failed');
			await nextTick();
			scope.stop();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});
	});

	describe('failed read', () => {
		it('repeats a failed read on the slow cadence while connected, until one answers', async () => {
			vi.useFakeTimers();
			const { read, deliver, freshness } = harness({ 'player:updated': true });
			await vi.advanceTimersByTimeAsync(0);

			// The read a change asked for fails: nothing else would ask again.
			read.mockRejectedValueOnce(new Error('unavailable')).mockRejectedValueOnce(new Error('unavailable'));
			deliver(1, 'player:updated', {});
			await vi.advanceTimersByTimeAsync(0);
			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('read 1');

			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS);
			expect(read).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS);
			expect(read).toHaveBeenCalledTimes(4);
			expect(freshness.data.value.label).toBe('read 4');

			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS * 3);
			expect(read).toHaveBeenCalledTimes(4);
		});

		it('does not repeat a failed read the mode has since stopped selecting', async () => {
			vi.useFakeTimers();
			const { read, selection } = harness();
			read.mockRejectedValueOnce(new Error('unavailable'));
			await vi.advanceTimersByTimeAsync(0);

			selection.value = null;
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('stops repeating when disposed', async () => {
			vi.useFakeTimers();
			const { read, scope } = harness();
			read.mockRejectedValueOnce(new Error('unavailable'));
			await vi.advanceTimersByTimeAsync(0);

			scope.stop();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_DEGRADED_REFETCH_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});
	});

	describe('reconnect', () => {
		async function dropAndComeBack(transport: ReturnType<typeof fakeTransport>['transport']) {
			transport.connectionState = 'suspended';
			await nextTick();
			transport.connectionState = 'connecting';
			await nextTick();
			transport.connectionState = 'connected';
			await flushPromises();
		}

		it('re-reads once its Event channel is attached again after losing continuity, holding what it shows until the read answers', async () => {
			const { read, transport, reattach, freshness } = harness();
			await flushPromises();

			let answer!: (held: Held) => void;
			read.mockReturnValueOnce(new Promise((resolve) => {
				answer = resolve;
			}));
			await dropAndComeBack(transport);
			expect(read).toHaveBeenCalledTimes(1);

			reattach(1);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('read 1');

			answer({ ids: [7], label: 'authoritative' });
			await flushPromises();
			expect(freshness.data.value.label).toBe('authoritative');
		});

		it('shows a change published after the connection came back but before its channel attached (#641)', async () => {
			const { read, transport, reattach, freshness } = harness();
			let published = 'before the drop';
			read.mockImplementation(async () => ({ ids: [7], label: published }));
			await flushPromises();

			await dropAndComeBack(transport);
			// Published while nothing listens on the channel, so never delivered.
			published = 'published before the attach';
			reattach(1);
			await flushPromises();

			expect(freshness.data.value.label).toBe('published before the attach');
		});

		it('does not re-read when the connection comes back with its channel\'s continuity resumed', async () => {
			const { read, transport } = harness();
			await flushPromises();

			await dropAndComeBack(transport);

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('re-reads for a channel-only loss while the connection stays up', async () => {
			const { read, reattach } = harness();
			await flushPromises();

			reattach(1);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('follows the continuity of the Event it is on, until disposed', async () => {
			const { read, reattach, eventId, scope } = harness();
			await flushPromises();

			eventId.value = 2;
			await flushPromises();
			reattach(1);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(1);

			reattach(2);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);

			scope.stop();
			reattach(2);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);
		});

		it('does not re-read on a first connection', async () => {
			const { read, transport } = harness();
			transport.connectionState = 'connecting';
			await flushPromises();
			transport.connectionState = 'connected';
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});
	});
});
