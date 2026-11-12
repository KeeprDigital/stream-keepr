import type { EffectScope } from 'vue';
import type { RealtimeConnectionState } from '~/types/realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, nextTick, ref, toValue, watch } from 'vue';
import { useReconnectResync } from '~~/app/composables/core/useReconnectResync';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';

/**
 * Reconnect Resync, driven through a stand-in transport: a consumer names the
 * channel it listens on, and is told to re-read when that channel attaches
 * again having lost continuity (#307, #641, #733).
 */

// The composable's Nuxt auto-imports, as Vue's own.
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('toValue', toValue);

type Transport = NonNullable<Parameters<typeof useReconnectResync>[2]>;
type ConnectionState = RealtimeConnectionState['connectionState'];

const scopes: EffectScope[] = [];

function harness({ channel: listenedOn = 'event:1' as string | null, attached = false, firstAttach = true } = {}) {
	const realtime = createFakeEventChannel();
	if (attached)
		realtime.attach(1);
	const channel = ref<string | null>(listenedOn);
	const resync = vi.fn();
	const onFirstAttach = vi.fn();
	const scope = effectScope();
	scopes.push(scope);
	const { disconnected } = scope.run(() => useReconnectResync(resync, channel, realtime.transport as unknown as Transport, firstAttach
		? { onFirstAttach }
		: {}))!;
	async function connection(...states: ConnectionState[]) {
		for (const state of states) {
			realtime.transport.connectionState = state;
			await nextTick();
		}
	}
	return {
		...realtime,
		channel,
		resync,
		onFirstAttach,
		disconnected,
		scope,
		connection,
	};
}

describe('useReconnectResync', () => {
	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	// A page's first moments are not a lost connection, so only these four report one.
	it.each<[ConnectionState, boolean]>([
		['initialized', false],
		['connecting', false],
		['connected', false],
		['disconnected', true],
		['suspended', true],
		['failed', true],
		['closed', true],
	])('a %s connection is disconnected: %s', async (state, expected) => {
		const { disconnected, connection } = harness();

		await connection(state);

		expect(disconnected.value).toBe(expected);
	});

	it('resyncs when the channel it listens on attaches again having lost continuity, and not for another channel\'s loss', () => {
		const { resync, reattach } = harness();

		reattach(2);
		expect(resync).not.toHaveBeenCalled();

		reattach(1);
		expect(resync).toHaveBeenCalledTimes(1);
	});

	// The channel's own signal is the reason (#641): a read sent when the
	// connection returns can be answered before anything listens again.
	it.each<[string, ConnectionState[]]>([
		[
			'its channel\'s continuity resumed',
			['suspended', 'connecting', 'connected'],
		],
		[
			'it first connects',
			['connecting', 'connected'],
		],
	])('does not resync when the connection comes back and %s', async (_, states) => {
		const { resync, connection } = harness();

		await connection(...states);

		expect(resync).not.toHaveBeenCalled();
	});

	it('follows the channel it is moved to, and listens on nothing once disposed', async () => {
		const { resync, reattach, channel, scope, listenedChannels } = harness();

		channel.value = 'event:2';
		await nextTick();
		reattach(1);
		expect(resync).not.toHaveBeenCalled();
		reattach(2);
		expect(resync).toHaveBeenCalledTimes(1);

		scope.stop();
		reattach(2);
		expect(resync).toHaveBeenCalledTimes(1);
		expect(listenedChannels()).toEqual([]);
	});

	describe('listening on no channel', () => {
		// It may hold nothing at all, as a Screen Output whose load failed: the connection coming back is its retry.
		it('resyncs once when the connection comes back, and not when it first connects', async () => {
			const { resync, connection, listenedChannels } = harness({ channel: null });
			expect(listenedChannels()).toEqual([]);

			await connection('connecting', 'connected');
			expect(resync).not.toHaveBeenCalled();

			await connection('suspended', 'connecting', 'connected');
			expect(resync).toHaveBeenCalledTimes(1);
		});

		it('stops listening on the channel it leaves', async () => {
			const { resync, reattach, attach, channel, onFirstAttach, listenedChannels } = harness();

			channel.value = null;
			await nextTick();
			reattach(1);
			attach(1);

			expect(resync).not.toHaveBeenCalled();
			expect(onFirstAttach).not.toHaveBeenCalled();
			expect(listenedChannels()).toEqual([]);
		});
	});

	// A first attach reports no continuity loss, so a consumer that read before it listened asks to be told (#733).
	describe('a first attach', () => {
		it('is told once to the consumer that asked, apart from its resync', () => {
			const { resync, onFirstAttach, attach } = harness();

			attach(1);
			attach(1);

			expect(onFirstAttach).toHaveBeenCalledTimes(1);
			expect(resync).not.toHaveBeenCalled();
		});

		it('is not told when the channel was attached before the consumer listened', () => {
			const { onFirstAttach, attach } = harness({ attached: true });

			attach(1);

			expect(onFirstAttach).not.toHaveBeenCalled();
		});

		it('is told for the channel it is moved to, and not for the one it left', async () => {
			const { onFirstAttach, attach, channel } = harness();

			channel.value = 'event:2';
			await nextTick();
			attach(1);
			expect(onFirstAttach).not.toHaveBeenCalled();

			attach(2);
			expect(onFirstAttach).toHaveBeenCalledTimes(1);
		});

		it('is no resync for a consumer that did not ask', () => {
			const { attach, resync } = harness({ firstAttach: false });

			attach(1);

			expect(resync).not.toHaveBeenCalled();
		});
	});

	it('reports no disconnection where there is no transport', () => {
		vi.stubGlobal('tryUseRealtime', () => undefined);
		const scope = effectScope();
		scopes.push(scope);

		const { disconnected } = scope.run(() => useReconnectResync(vi.fn(), 'event:1'))!;

		expect(disconnected.value).toBe(false);
	});
});
