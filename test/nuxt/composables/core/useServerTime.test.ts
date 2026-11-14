import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const { mockFetch } = vi.hoisted(() => {
	// Before anything else here runs: the app's boot has already started a sync
	// that goes unanswered and ends by warning.
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	return {
		mockFetch: vi.fn(),
	};
});
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

/** A `/api/time` request that gets no answer. */
const dropped = () => Promise.reject(new Error('dropped'));

async function syncWith(...answers: Array<() => Promise<unknown>>) {
	for (const answer of answers)
		mockFetch.mockImplementationOnce(answer);
	const serverTime = useServerTime();
	const synced = serverTime.sync();
	await vi.advanceTimersByTimeAsync(1_000);
	await synced;
	return serverTime;
}

/**
 * Holds an offset of 800 ms, then takes a sync whose samples answer at once and
 * report `offset`. Resolves as that sync lands, before any time has passed since.
 */
async function correctTo(offset: number, held = true) {
	await syncWith(sample(20, 800), sample(20, 800), sample(20, 800));
	useState('serverTimeSynced').value = held;
	mockFetch.mockImplementation(sample(0, offset));
	const serverTime = useServerTime();
	const synced = serverTime.sync();
	await vi.advanceTimersByTimeAsync(100);
	await synced;
	return serverTime;
}

/** Restarts the shared sync on this test's clock, as the first consumer starts it, and lets it land. */
async function restartSync() {
	useServerTime().stopSync();
	const serverTime = useServerTime();
	await vi.advanceTimersByTimeAsync(1_000);
	return serverTime;
}

/**
 * A server that answers at once with its own clock, and a device clock that can
 * be changed under it, dropping the next `unanswered` requests after a change.
 */
function deviceClock() {
	let deviceAhead = 0;
	let unanswered = 0;
	const serverNow = () => Date.now() - deviceAhead;
	mockFetch.mockImplementation(async () => {
		if (unanswered > 0) {
			unanswered--;
			throw new Error('dropped');
		}
		return {
			serverTime: serverNow(),
		};
	});
	return {
		serverNow,
		changeDeviceClock(change: number, drop = 0) {
			deviceAhead += change;
			unanswered = drop;
			vi.setSystemTime(Date.now() + change);
		},
	};
}

describe('useServerTime', () => {
	// The app's boot starts the shared sync on real timers: three samples now and
	// a re-sync every minute, any of which would land inside a test and take that
	// test's answers. Stop the re-sync, then run a salvo to its end: it starts
	// after the boot's and takes the same steps, so it ends after it.
	beforeAll(async () => {
		const serverTime = useServerTime();
		serverTime.stopSync();
		await serverTime.sync();
	});

	beforeEach(async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		// A use while the shared sync is stopped restarts it, on this fake clock;
		// let that settle on a clean, synced state so each test drives `sync` alone.
		// From unsynced, so it steps to zero rather than easing there through the test.
		useState('serverTimeSynced').value = false;
		mockFetch.mockImplementation(sample(0, 0));
		await syncWith();
		mockFetch.mockReset();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// A round trip bounds its sample's error to half of itself, so the tightest is the best.
	it('compensates each sample for its round trip and takes the one with the shortest', async () => {
		const serverTime = await syncWith(sample(400, 5_000), sample(20, 1_000), sample(40, 1_200));

		expect(serverTime.isSynced.value).toBe(true);
		expect(serverTime.serverTimeOffset.value).toBe(1_000);
		expect(serverTime.getServerTime()).toBe(Date.now() + 1_000);
	});

	it('syncs from the samples that answered when one fails', async () => {
		const serverTime = await syncWith(sample(20, 800), () => Promise.reject(new Error('dropped')), sample(30, 800));

		expect(serverTime.isSynced.value).toBe(true);
		expect(serverTime.serverTimeOffset.value).toBe(800);
	});

	// A missed re-sync is not an unknown clock: Page Rotations and playout keep
	// running on the offset already held (ADR-0009).
	it('keeps the offset it holds when a later sync gets no answer, warning once', async () => {
		await syncWith(sample(20, 800), sample(20, 800), sample(20, 800));
		mockFetch.mockRejectedValue(new Error('offline'));

		const serverTime = await syncWith();
		await syncWith();

		expect(serverTime.isSynced.value).toBe(true);
		expect(serverTime.serverTimeOffset.value).toBe(800);
		expect(console.warn).toHaveBeenCalledOnce();
	});

	// A sample's round trip is one request's: a retry inside it would count the
	// timed-out attempt as latency and skew the offset by half of it (#1025).
	it('does not take a sample from a request that had to be retried', async () => {
		const retried = async (_url: string, request: { retry?: number }) => {
			vi.setSystemTime(Date.now() + 3_000);
			if (!request.retry)
				throw new Error('timeout');
			return { serverTime: Date.now() + 800 };
		};

		useState('serverTimeSynced').value = false;

		const serverTime = await syncWith(retried as () => Promise<unknown>, dropped, dropped);

		expect(serverTime.isSynced.value).toBe(false);
	});

	// A round trip above the ceiling bounds the offset too loosely to replace one
	// already held; with none held, a loose offset still beats an unknown clock.
	it.each([
		{
			name: 'takes a sample at the ceiling over the offset it holds',
			held: true,
			answers: [
				sample(1_000, 5_000),
				dropped,
				dropped,
			],
			offset: 5_000,
		},
		{
			name: 'takes a tighter sample over a shorter one above the ceiling',
			held: false,
			answers: [
				sample(1_002, 5_000),
				dropped,
				sample(1_000, 900),
			],
			offset: 900,
		},
		{
			name: 'keeps the offset it holds when every sample is above the ceiling',
			held: true,
			answers: [
				sample(1_002, 5_000),
				dropped,
				dropped,
			],
			offset: 800,
		},
		{
			name: 'takes a sample above the ceiling while it holds no offset',
			held: false,
			answers: [
				sample(1_002, 5_000),
				dropped,
				dropped,
			],
			offset: 5_000,
		},
	])('$name', async ({ held, answers, offset }) => {
		await syncWith(sample(20, 800), sample(20, 800), sample(20, 800));
		useState('serverTimeSynced').value = held;

		const serverTime = await syncWith(...answers);

		expect(serverTime.serverTimeOffset.value).toBe(offset);
	});

	// A correction applied as a step can show one digit twice, or skip one. Eased
	// in at no more than a tenth of elapsed time, server time only ever advances.
	it.each([
		{ name: 'back', offset: 500 },
		{ name: 'forward', offset: 1_100 },
	])('eases a small correction $name without server time stopping or jumping', async ({ offset }) => {
		const serverTime = await syncWith(sample(20, 800), sample(20, 800), sample(20, 800));
		mockFetch.mockImplementation(sample(0, offset));

		// The sync lands inside the first step.
		const synced = serverTime.sync();
		const advances: number[] = [];
		for (let step = 0; step < 40; step++) {
			const before = serverTime.getServerTime();
			await vi.advanceTimersByTimeAsync(100);
			advances.push(serverTime.getServerTime() - before);
		}
		await synced;

		expect(Math.min(...advances)).toBeGreaterThanOrEqual(89.999);
		expect(Math.max(...advances)).toBeLessThanOrEqual(110.001);
		expect(serverTime.getServerTime()).toBe(Date.now() + offset);
	});

	// A clock that is badly wrong is put right at once, as is one not yet known.
	it.each([
		{
			name: 'eases a correction at the threshold',
			held: true,
			offset: 1_300,
			appliedAtOnce: 0,
		},
		{
			name: 'steps a correction over the threshold',
			held: true,
			offset: 1_301,
			appliedAtOnce: 501,
		},
		{
			name: 'steps a correction back over the threshold',
			held: true,
			offset: 299,
			appliedAtOnce: -501,
		},
		{
			name: 'steps the first sync, however small',
			held: false,
			offset: 900,
			appliedAtOnce: 100,
		},
	])('$name', async ({ held, offset, appliedAtOnce }) => {
		const serverTime = await correctTo(offset, held);

		expect(serverTime.getServerTime() - Date.now()).toBe(800 + appliedAtOnce);
	});

	// A correction is measured from the server time being read, so one that
	// interrupts another carries on from where that one had reached.
	it('eases a second correction on from a first that is still running', async () => {
		const serverTime = await correctTo(1_200);
		await vi.advanceTimersByTimeAsync(900);
		mockFetch.mockImplementation(sample(0, 600));

		const synced = serverTime.sync();
		await vi.advanceTimersByTimeAsync(100);
		await synced;

		expect(serverTime.getServerTime() - Date.now()).toBe(900);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(serverTime.getServerTime() - Date.now()).toBe(600);
	});

	// A wait timed while a correction ran is off by what the correction went on
	// to apply, so whatever read server time reactively reads it again at its end.
	it('answers a reactive reader of server time again once a correction is eased in', async () => {
		const serverTime = await correctTo(1_100);
		const ahead = computed(() => serverTime.getServerTime() - Date.now());
		expect(ahead.value).toBe(800);

		await vi.advanceTimersByTimeAsync(3_000);

		expect(ahead.value).toBe(1_100);
	});

	// Eased in, server time runs at eleven or nine tenths of the device's, so a
	// wait for it is that much shorter or longer on the device, to the ease's end.
	it.each([
		{
			name: 'with no correction running',
			offset: 800,
			serverMs: 1_000,
			deviceMs: 1_000,
		},
		{
			name: 'inside a correction forward',
			offset: 1_100,
			serverMs: 1_100,
			deviceMs: 1_000,
		},
		{
			name: 'past the end of a correction forward',
			offset: 1_100,
			serverMs: 5_000,
			deviceMs: 4_700,
		},
		{
			name: 'inside a correction back',
			offset: 500,
			serverMs: 900,
			deviceMs: 1_000,
		},
		{
			name: 'past the end of a correction back',
			offset: 500,
			serverMs: 5_000,
			deviceMs: 5_300,
		},
	])('answers how long the device waits for server time to advance, $name', async ({ offset, serverMs, deviceMs }) => {
		const serverTime = await correctTo(offset);
		const from = serverTime.getServerTime();

		const wait = serverTime.deviceDelayFor(serverMs);
		await vi.advanceTimersByTimeAsync(wait);

		expect(wait).toBe(deviceMs);
		expect(serverTime.getServerTime() - from).toBeCloseTo(serverMs, 6);
	});

	// `beforeunload` also fires for an unload the operator cancels, so the shared
	// sync runs until the page is actually hidden.
	it.each([
		{ event: 'beforeunload', keepsSyncing: true },
		{ event: 'pagehide', keepsSyncing: false },
	])('keeps the periodic sync running after $event: $keepsSyncing', async ({ event, keepsSyncing }) => {
		mockFetch.mockImplementation(sample(0, 0));
		const serverTime = await restartSync();
		const syncedAt = serverTime.lastSyncedAt.value!;

		window.dispatchEvent(new Event(event));
		await vi.advanceTimersByTimeAsync(61_000);

		expect(serverTime.lastSyncedAt.value! > syncedAt).toBe(keepsSyncing);
	});

	// A hidden tab's timers are throttled and an offline device's sync goes
	// unanswered, so a page coming back asks at once rather than at the next minute.
	it.each([
		{
			name: 're-syncs when the page becomes visible',
			target: () => document,
			event: 'visibilitychange',
			visibility: 'visible',
			sinceLastSync: 6_000,
			resyncs: true,
		},
		{
			name: 'does not re-sync when the page is hidden',
			target: () => document,
			event: 'visibilitychange',
			visibility: 'hidden',
			sinceLastSync: 6_000,
			resyncs: false,
		},
		{
			name: 're-syncs when the browser comes back online',
			target: () => window,
			event: 'online',
			visibility: 'visible',
			sinceLastSync: 6_000,
			resyncs: true,
		},
		{
			name: 'does not re-sync so soon after a sync',
			target: () => window,
			event: 'online',
			visibility: 'visible',
			sinceLastSync: 4_000,
			resyncs: false,
		},
	])('$name', async ({ target, event, visibility, sinceLastSync, resyncs }) => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility as DocumentVisibilityState);
		mockFetch.mockImplementation(sample(0, 0));
		const serverTime = await restartSync();
		const syncedAt = serverTime.lastSyncedAt.value!;
		await vi.advanceTimersByTimeAsync(syncedAt + sinceLastSync - Date.now());

		target().dispatchEvent(new Event(event));
		await vi.advanceTimersByTimeAsync(1_000);

		expect(serverTime.lastSyncedAt.value! > syncedAt).toBe(resyncs);
	});

	// A visible, online tab gets no event when its device's clock is changed, so
	// server time would read wrong to the next minute: the change itself re-syncs.
	it.each([
		{
			name: 're-syncs when the device clock is set forward past the threshold',
			sinceLastSync: 6_000,
			change: 501,
			unanswered: 0,
			wrongBy: 0,
		},
		{
			name: 'does not re-sync for a change at the threshold',
			sinceLastSync: 6_000,
			change: 500,
			unanswered: 0,
			wrongBy: 500,
		},
		{
			name: 're-syncs when the device clock is set back',
			sinceLastSync: 6_000,
			change: -600_000,
			unanswered: 0,
			wrongBy: 0,
		},
		{
			name: 're-syncs for a change just after a sync once the gap has passed',
			sinceLastSync: 1_000,
			change: 2_000,
			unanswered: 0,
			wrongBy: 0,
		},
		{
			name: 're-syncs again when the re-sync after a change goes unanswered',
			sinceLastSync: 6_000,
			change: 2_000,
			unanswered: 3,
			wrongBy: 0,
		},
	])('$name', async ({ sinceLastSync, change, unanswered, wrongBy }) => {
		const { serverNow, changeDeviceClock } = deviceClock();
		const serverTime = await restartSync();
		await vi.advanceTimersByTimeAsync(serverTime.lastSyncedAt.value! + sinceLastSync - Date.now());

		changeDeviceClock(change, unanswered);
		await vi.advanceTimersByTimeAsync(8_000);

		expect(serverTime.getServerTime() - serverNow()).toBe(wrongBy);
	});

	// An unreachable server is not asked once a second for as long as the change stands.
	it('asks again after a change no faster than the gap while unanswered', async () => {
		const { changeDeviceClock } = deviceClock();
		await restartSync();
		await vi.advanceTimersByTimeAsync(6_000);
		mockFetch.mockClear();

		changeDeviceClock(2_000, Infinity);
		await vi.advanceTimersByTimeAsync(10_500);

		expect(mockFetch).toHaveBeenCalledTimes(6);
	});
});
