import type { EffectScope } from 'vue';
import type { ScreenModeDependencies, ScreenModeFreshnessTransport } from '~/modules/screen-mode/freshness';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { SCREEN_MODE_REREAD_MS, useScreenModeFreshness } from '~/modules/screen-mode/freshness';

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

const scopes: EffectScope[] = [];

function harness(dependsOn: ScreenModeDependencies<Held> = {}, { attached = [] as number[] } = {}) {
	const realtime = createFakeEventChannel();
	for (const eventId of attached)
		realtime.attach(eventId);
	const eventId = ref<number | null>(1);
	const selection = ref<number | null>(7);
	const read = vi.fn(async (): Promise<Held> => ({
		ids: [selection.value!],
		label: `read ${read.mock.calls.length}`,
	}));
	const scope = effectScope();
	scopes.push(scope);
	const freshness = scope.run(() => useScreenModeFreshness<Held>({
		eventId,
		source: () => selection.value === null
			? null
			: String(selection.value),
		read,
		initialData: { ids: [], label: 'none' },
		errorMessage: 'Failed to read',
		dependsOn,
		realtime: realtime.transport as unknown as ScreenModeFreshnessTransport,
	}))!;
	return {
		...realtime,
		eventId,
		selection,
		read,
		freshness,
		scope,
	};
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
			expect(freshness.data.value).toEqual({
				ids: [7],
				label: 'read 1',
			});

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

			deliver('match:deleted', { matchId: 7 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('read 2');
		});

		it('ignores a message that does not touch what it holds, and types it does not depend on', async () => {
			const { read, deliver } = harness({
				'match:deleted': (message, held) => held.ids.includes(message.matchId),
			});
			await flushPromises();

			deliver('match:deleted', { matchId: 99 });
			deliver('round:deleted', { roundId: 7 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('re-reads on every message of a type it depends on unconditionally', async () => {
			const { read, deliver } = harness({ 'phase:deleted': true });
			await flushPromises();

			deliver('phase:deleted', { phaseId: 3 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('re-reads after a dependency message heard while a read is in flight', async () => {
			// What is held cannot judge a message the in-flight read may predate.
			const { read, deliver } = harness({
				'match:deleted': (message, held) => held.ids.includes(message.matchId),
			});

			deliver('match:deleted', { matchId: 99 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('shows only the follow-up\'s answer when a message is heard during its first read (#567)', async () => {
			// Nothing is on program yet, so the first read's answer would only make
			// the follow-up a second rendering.
			const { read, deliver, freshness } = harness({ 'player:updated': true });
			const shown: string[] = [];
			watch(freshness.data, held => shown.push(held.label), { flush: 'sync' });

			deliver('player:updated');
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
			expect(shown).toEqual(['read 2']);
		});

		it('coalesces a burst of messages into one read', async () => {
			const { read, deliver } = harness({ 'phase:deleted': true });
			await flushPromises();

			deliver('phase:deleted', { phaseId: 3 });
			deliver('phase:deleted', { phaseId: 4 });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('reads once more, not once per message, for a burst heard in separate frames while a read is in flight (#650)', async () => {
			const { read, deliver, freshness } = harness({ 'player:updated': true });
			await flushPromises();

			let published = 'before the burst';
			let answer!: () => void;
			read.mockImplementationOnce(() => {
				const served = published;
				return new Promise((resolve) => {
					answer = () => resolve({
						ids: [7],
						label: served,
					});
				});
			});
			read.mockImplementation(async () => ({
				ids: [7],
				label: published,
			}));
			for (const player of [1, 2, 3, 4]) {
				published = `after player ${player}`;
				deliver('player:updated', { player });
				await flushPromises();
			}
			expect(read).toHaveBeenCalledTimes(2);

			answer();
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value.label).toBe('after player 4');
		});

		it('renders the follow-up\'s answer when messages keep coming through a first read', async () => {
			const { read, deliver, freshness } = harness({ 'player:updated': true });
			const shown: string[] = [];
			watch(freshness.data, held => shown.push(held.label), { flush: 'sync' });
			deliver('player:updated');
			read.mockImplementationOnce(async () => {
				deliver('player:updated');
				return {
					ids: [7],
					label: 'follow-up',
				};
			});
			await flushPromises();

			// Only the load's answer is dropped: the follow-up's lands, then the next.
			expect(shown).toEqual(['follow-up', 'read 3']);
		});

		it('supersedes a read that has hung for the slow cadence when a message is heard', async () => {
			vi.useFakeTimers();
			const { read, deliver, freshness } = harness({ 'player:updated': true });
			await vi.advanceTimersByTimeAsync(0);

			read.mockImplementationOnce(() => new Promise(() => {}));
			deliver('player:updated');
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			deliver('player:updated');
			await vi.advanceTimersByTimeAsync(0);

			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value.label).toBe('read 3');
		});

		it('still supersedes the read in flight at once on a change of selection', async () => {
			const { read, deliver, selection, freshness } = harness({ 'player:updated': true });
			await flushPromises();

			let answer!: () => void;
			read.mockImplementationOnce(() => new Promise((resolve) => {
				answer = () => resolve({
					ids: [7],
					label: 'superseded',
				});
			}));
			deliver('player:updated');
			await flushPromises();
			deliver('player:updated');
			selection.value = 9;
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value.ids).toEqual([9]);

			answer();
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value.ids).toEqual([9]);
		});

		it('follows the Event it is on, and stops listening when disposed', async () => {
			const { read, deliver, eventId, listeners, scope } = harness({ 'phase:deleted': true });
			await flushPromises();

			eventId.value = 2;
			await flushPromises();
			deliver('phase:deleted', { phaseId: 3 });
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(1);

			deliver('phase:deleted', { phaseId: 3 }, 2);
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
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			expect(read).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			expect(read).toHaveBeenCalledTimes(3);

			// Recovered: whatever was published while nothing listened is gone, so
			// recovery is itself a reason to re-read; the cadence then stops.
			transport.tokenError = null;
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(4);
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 3);
			expect(read).toHaveBeenCalledTimes(4);
		});

		it('re-reads on a cadence while disconnected, and holds what it shows when a read fails', async () => {
			vi.useFakeTimers();
			const { read, transport, freshness } = harness();
			await flushPromises();

			transport.connectionState = 'suspended';
			read.mockRejectedValueOnce(new Error('offline'));
			await nextTick();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);

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
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('stops its cadence when disposed', async () => {
			vi.useFakeTimers();
			const { read, transport, scope } = harness();
			await flushPromises();

			transport.tokenError = new Error('mint failed');
			await nextTick();
			scope.stop();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 2);

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
			deliver('player:updated');
			await vi.advanceTimersByTimeAsync(0);
			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('read 1');

			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			expect(read).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			expect(read).toHaveBeenCalledTimes(4);
			expect(freshness.data.value.label).toBe('read 4');

			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 3);
			expect(read).toHaveBeenCalledTimes(4);
		});

		it('reads the follow-up at once, rather than on the cadence, when the read it followed fails', async () => {
			vi.useFakeTimers();
			const { read, deliver, freshness } = harness({ 'player:updated': true });
			await vi.advanceTimersByTimeAsync(0);

			let fail!: () => void;
			read.mockImplementationOnce(() => new Promise((_resolve, reject) => {
				fail = () => reject(new Error('unavailable'));
			}));
			deliver('player:updated');
			await vi.advanceTimersByTimeAsync(0);
			deliver('player:updated');
			fail();
			await vi.advanceTimersByTimeAsync(0);

			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value.label).toBe('read 3');
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 3);
			expect(read).toHaveBeenCalledTimes(3);
		});

		it('does not repeat a failed read the mode has since stopped selecting', async () => {
			vi.useFakeTimers();
			const { read, selection } = harness();
			read.mockRejectedValueOnce(new Error('unavailable'));
			await vi.advanceTimersByTimeAsync(0);

			selection.value = null;
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('stops repeating when disposed', async () => {
			vi.useFakeTimers();
			const { read, scope } = harness();
			read.mockRejectedValueOnce(new Error('unavailable'));
			await vi.advanceTimersByTimeAsync(0);

			scope.stop();
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 2);

			expect(read).toHaveBeenCalledTimes(1);
		});
	});

	describe('reconnect', () => {
		async function dropAndComeBack(transport: ReturnType<typeof createFakeEventChannel>['transport']) {
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

			answer({
				ids: [7],
				label: 'authoritative',
			});
			await flushPromises();
			expect(freshness.data.value.label).toBe('authoritative');
		});

		it('shows a change published after the connection came back but before its channel attached (#641)', async () => {
			const { read, transport, reattach, freshness } = harness();
			let published = 'before the drop';
			read.mockImplementation(async () => ({
				ids: [7],
				label: published,
			}));
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

		it('supersedes the read in flight, which may predate the loss', async () => {
			const { read, reattach, freshness } = harness();
			await flushPromises();

			read.mockImplementationOnce(() => new Promise(() => {}));
			reattach(1);
			await flushPromises();
			reattach(1);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value.label).toBe('read 3');
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

	describe('first attach', () => {
		it('shows a change published after its first read but before its Event channel first attached (#733)', async () => {
			const { read, attach, freshness } = harness();
			await flushPromises();
			expect(freshness.data.value.label).toBe('read 1');

			// Published while nothing listens on the channel, so never delivered.
			read.mockImplementation(async () => ({
				ids: [7],
				label: 'published before the attach',
			}));
			attach(1);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value.label).toBe('published before the attach');
		});

		it('renders the load it lands during, then re-reads, rather than superseding that load', async () => {
			const { read, attach, selection, freshness } = harness();
			await flushPromises();
			const shown: string[] = [];
			watch(freshness.data, held => shown.push(held.label), { flush: 'sync' });
			let answer!: () => void;
			read.mockImplementationOnce(() => new Promise((resolve) => {
				answer = () => resolve({
					ids: [9],
					label: 'load',
				});
			}));
			selection.value = 9;
			await flushPromises();

			attach(1);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);

			answer();
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(3);
			expect(shown).toEqual(['load', 'read 3']);
		});

		it('re-reads once, however often its channel attaches afterwards', async () => {
			const { read, attach } = harness();
			await flushPromises();

			attach(1);
			await flushPromises();
			attach(1);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('does not re-read when its channel was already attached before it read', async () => {
			const { read, attach } = harness({}, {
				attached: [1],
			});
			await flushPromises();

			attach(1);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('waits on the first attach of the Event it moves to, and stops waiting when disposed', async () => {
			const { read, attach, eventId, scope } = harness();
			await flushPromises();

			eventId.value = 2;
			await flushPromises();
			const afterMove = read.mock.calls.length;
			attach(1);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(afterMove);

			scope.stop();
			attach(2);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(afterMove);
		});

		it('re-reads on the first attach of the Event it moves to', async () => {
			const { read, attach, eventId } = harness();
			await flushPromises();

			eventId.value = 2;
			await flushPromises();
			const afterMove = read.mock.calls.length;
			attach(2);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(afterMove + 1);
		});

		it('reads nothing on its first attach while the mode selects nothing', async () => {
			const { read, attach, selection } = harness();
			await flushPromises();
			selection.value = null;
			await flushPromises();

			attach(1);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});
	});
});
