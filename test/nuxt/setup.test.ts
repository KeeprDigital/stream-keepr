/**
 * The contract of the shared Nuxt suite setup (#367): the two background
 * singletons that write through `$fetch` — `useServerTime`'s clock sync and the
 * realtime plugin's token mint — never reach a suite's `$fetch` mock.
 *
 * This file mocks `$fetch` exactly the way the 40-odd affected suites do, pokes
 * each singleton the way an ordinary mount does, and asserts the mock recorded
 * nothing. At a tip without the shared setup both halves are red: the first
 * `useServerTime()` consumer fires an `/api/time` sample in the same tick, and
 * the first Event-scoped room subscription mints a token through
 * `/api/realtime/token`. Either stray is what #367's five costumes dress up as —
 * a tripped `not.toHaveBeenCalled()`, a drained `mockResolvedValueOnce` queue,
 * a shifted `toHaveBeenNthCalledWith` slot, or the graphics-assets page suite's
 * 1-in-3 `idempotencyKey` TypeError.
 *
 * The stubs must also keep both surfaces usable, or the cure would spread its
 * own class of breakage — so this file asserts the replacement behaviour too:
 * server time still reads as a clock, and the realtime transport still hands
 * out its API.
 */

import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { callsTo } from '~~/test/helpers/lastCallTo';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

/**
 * Past every stray a singleton would send: the clock sync fires its first sample
 * in the same tick and two more at 50ms spacing, so 130ms covers the salvo. On a
 * fake clock, because a real wait can end before a loaded machine reaches them.
 */
async function settle() {
	await vi.advanceTimersByTimeAsync(130);
}

describe('shared nuxt suite setup', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('a useServerTime consumer starts no clock sync against the suite $fetch mock', async () => {
		// The singleton auto-started when the app booted for this file (the default
		// layout renders UIServerTimeStatus), which is exactly how a victim suite
		// meets it: sample one lands before the first test and `clearMocks` wipes
		// it, samples two and three land ~50/100ms into the first test's window.
		// Re-arm it here so this test owns the whole salvo.
		const { getServerTime, stopSync, startSync } = useServerTime();
		stopSync();
		// After the stop, which clears an interval the boot set on the real clock.
		vi.useFakeTimers();
		startSync();
		await settle();

		// Throws a named error listing what arrived if any sample got through.
		expect(callsTo(mockFetch, 0, '/api/time')).toEqual([]);
		// The stub is still a clock: consumers like Page Rotation read it as one.
		expect(getServerTime()).toBeTypeOf('number');
	});

	it('an Event-scoped room subscription mints no token against the suite $fetch mock', async () => {
		vi.useFakeTimers();
		const realtime = useRealtime();
		realtime.setRoom(eventRealtimeChannel(7));
		await settle();

		// Throws a named error listing what arrived if a token was minted.
		expect(callsTo(mockFetch, 0, '/api/realtime/token')).toEqual([]);
		// The transport is still provided and still answers its API.
		expect(realtime.onChannel).toBeTypeOf('function');
		realtime.setRoom(null);
	});
});
