import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
// test/nuxt/setup.ts stubs `useServerTime` for every suite; this file tests the real one.
vi.unmock('~/composables/core/useServerTime');

/** A `/api/time` answer that takes `rtt` ms and reports a server clock `offset` ms ahead. */
function sample(rtt: number, offset: number) {
	return async () => {
		const sentAt = Date.now();
		vi.setSystemTime(sentAt + rtt);
		return { serverTime: sentAt + rtt / 2 + offset };
	};
}

async function syncWith(...answers: Array<() => Promise<unknown>>) {
	for (const answer of answers)
		mockFetch.mockImplementationOnce(answer);
	const serverTime = useServerTime();
	const synced = serverTime.sync();
	await vi.advanceTimersByTimeAsync(1_000);
	await synced;
	return serverTime;
}

describe('useServerTime', () => {
	// The app's boot starts the shared sync on real timers, and its three samples
	// would land inside a test and take that test's answers. Unanswered, the
	// salvo ends by warning; wait for that before any test queues an answer.
	beforeAll(async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		useServerTime();
		await vi.waitFor(() => expect(useState('serverTimeSyncWarned').value).toBe(true));
	});

	beforeEach(async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		// The first use starts the shared periodic sync; let it settle on a clean,
		// synced state so each test drives `sync` alone.
		mockFetch.mockImplementation(sample(0, 0));
		await syncWith();
		mockFetch.mockReset();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('compensates each sample for its round trip and drops the slowest', async () => {
		const serverTime = await syncWith(sample(400, 5_000), sample(20, 1_000), sample(40, 1_200));

		expect(serverTime.isSynced.value).toBe(true);
		expect(serverTime.serverTimeOffset.value).toBe(1_100);
		expect(serverTime.getServerTime()).toBe(Date.now() + 1_100);
	});

	it('syncs from the samples that answered when one fails', async () => {
		const serverTime = await syncWith(sample(20, 800), () => Promise.reject(new Error('dropped')), sample(30, 800));

		expect(serverTime.isSynced.value).toBe(true);
		expect(serverTime.serverTimeOffset.value).toBe(800);
	});

	it('falls back to local time when no sample answers, warning once', async () => {
		mockFetch.mockRejectedValue(new Error('offline'));

		const serverTime = await syncWith();
		await syncWith();

		expect(serverTime.isSynced.value).toBe(false);
		expect(console.warn).toHaveBeenCalledOnce();
	});

	// `beforeunload` also fires for an unload the operator cancels, so the shared
	// sync runs until the page is actually hidden.
	it.each([
		{ event: 'beforeunload', keepsSyncing: true },
		{ event: 'pagehide', keepsSyncing: false },
	])('keeps the periodic sync running after $event: $keepsSyncing', async ({ event, keepsSyncing }) => {
		mockFetch.mockImplementation(sample(0, 0));
		// Restart the shared sync on this test's clock, as the first consumer starts it.
		useServerTime().stopSync();
		const serverTime = useServerTime();
		await vi.advanceTimersByTimeAsync(1_000);
		const syncedAt = serverTime.lastSyncedAt.value!;

		window.dispatchEvent(new Event(event));
		await vi.advanceTimersByTimeAsync(61_000);

		expect(serverTime.lastSyncedAt.value! > syncedAt).toBe(keepsSyncing);
	});
});
