import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = 1_000_000;

const isSynced = ref(true);
const serverTimeOffset = ref(0);
/** How fast server time runs against the device's: other than 1 while a correction is eased in. */
let serverTimeRate = 1;

// The shared clock, faked: server time is this browser's, plus an offset a sync
// may move, running from `NOW` at `serverTimeRate`.
mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime(() => ({
	isSynced,
	serverTimeOffset,
	getServerTime: () => NOW + (Date.now() - NOW) * serverTimeRate + serverTimeOffset.value,
	deviceDelayFor: serverMs => Math.ceil(serverMs / serverTimeRate),
})));

/** Whole seconds of server time, changing as each second is reached. */
function secondsOf(serverTime: number) {
	return {
		value: Math.floor(serverTime / 1000),
		nextChangeInMs: 1000 - serverTime % 1000,
	};
}

const scopes: EffectScope[] = [];

function inScope<T>(setup: () => T) {
	const scope = effectScope();
	scopes.push(scope);
	return {
		scope,
		result: scope.run(setup)!,
	};
}

describe('useClockProjection', () => {
	beforeEach(() => {
		vi.useFakeTimers({
			toFake: ['Date', 'setTimeout', 'clearTimeout'],
			now: NOW,
		});
		isSynced.value = true;
		serverTimeOffset.value = 0;
		serverTimeRate = 1;
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	it('answers anew exactly as its value next changes, wherever in the wait it began', async () => {
		vi.setSystemTime(NOW + 900);
		const { result: seconds } = inScope(() => useClockProjection(secondsOf, { whileServerTimeUnknown: 'device-time' }));
		expect(seconds.value).toBe(1000);

		await vi.advanceTimersByTimeAsync(99);
		expect(seconds.value).toBe(1000);
		await vi.advanceTimersByTimeAsync(1);
		expect(seconds.value).toBe(1001);

		await vi.advanceTimersByTimeAsync(1000);
		expect(seconds.value).toBe(1002);
	});

	it('answers anew when an input its projection reads changes', async () => {
		const startedAt = ref(NOW);
		const { result: elapsed } = inScope(() => useClockProjection(
			serverTime => ({ value: serverTime - startedAt.value, nextChangeInMs: null }),
			{ whileServerTimeUnknown: 'device-time' },
		));
		expect(elapsed.value).toBe(0);

		startedAt.value = NOW - 5000;

		expect(elapsed.value).toBe(5000);
	});

	// A re-sync moves server time under a wait already begun: the wait is retaken from the new time.
	it('answers anew when server time re-syncs, and changes on its new boundaries', async () => {
		const { result: seconds } = inScope(() => useClockProjection(secondsOf, { whileServerTimeUnknown: 'device-time' }));

		serverTimeOffset.value = 5400;
		expect(seconds.value).toBe(1005);

		await vi.advanceTimersByTimeAsync(599);
		expect(seconds.value).toBe(1005);
		await vi.advanceTimersByTimeAsync(1);
		expect(seconds.value).toBe(1006);
	});

	// A correction being eased in runs server time faster or slower than the
	// device's, so the wait is for server time to reach the change, not the device's.
	it('answers anew as server time reaches the change while a correction is eased in', async () => {
		serverTimeRate = 1.1;
		const { result: seconds } = inScope(() => useClockProjection(secondsOf, { whileServerTimeUnknown: 'device-time' }));

		await vi.advanceTimersByTimeAsync(909);
		expect(seconds.value).toBe(1000);
		await vi.advanceTimersByTimeAsync(1);
		expect(seconds.value).toBe(1001);
	});

	it('shows its declared answer while server time is unknown, and projects once it is known', async () => {
		isSynced.value = false;
		const project = vi.fn(secondsOf);
		const { result: seconds } = inScope(() => useClockProjection(project, {
			whileServerTimeUnknown: {
				show: () => -1,
			},
		}));

		await vi.advanceTimersByTimeAsync(3000);
		expect(seconds.value).toBe(-1);
		expect(project).not.toHaveBeenCalled();

		isSynced.value = true;
		expect(seconds.value).toBe(1003);
		await vi.advanceTimersByTimeAsync(1000);
		expect(seconds.value).toBe(1004);
	});

	// A first sync that finds the device exact leaves the offset at zero: it still re-evaluates.
	it('projects on device time while server time is unknown where declared, and anew as the first sync lands', async () => {
		isSynced.value = false;
		const project = vi.fn(secondsOf);
		const { result: seconds } = inScope(() => useClockProjection(project, { whileServerTimeUnknown: 'device-time' }));
		expect(seconds.value).toBe(1000);
		await vi.advanceTimersByTimeAsync(1000);
		expect(seconds.value).toBe(1001);

		project.mockClear();
		isSynced.value = true;
		await nextTick();

		expect(project).toHaveBeenCalled();
	});

	// Further off than one timer can wait (2^31 - 1 ms), it waits in steps rather than spinning.
	it('waits out a change further off than one timer can hold', async () => {
		const day = 24 * 60 * 60_000;
		const startsAt = NOW + 30 * day;
		const project = vi.fn((serverTime: number) => serverTime < startsAt
			? { value: 'pending', nextChangeInMs: startsAt - serverTime }
			: { value: 'running', nextChangeInMs: null });
		const { result: state } = inScope(() => useClockProjection(project, { whileServerTimeUnknown: 'device-time' }));
		expect(state.value).toBe('pending');

		project.mockClear();
		await vi.advanceTimersByTimeAsync(30 * day - 1);
		expect(state.value).toBe('pending');
		expect(project.mock.calls.length).toBeLessThan(5);

		await vi.advanceTimersByTimeAsync(1);
		expect(state.value).toBe('running');
	});

	it('stops answering anew once its owner is disposed', async () => {
		const project = vi.fn(secondsOf);
		const { scope } = inScope(() => useClockProjection(project, { whileServerTimeUnknown: 'device-time' }));

		scope.stop();
		project.mockClear();
		await vi.advanceTimersByTimeAsync(5000);

		expect(project).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
