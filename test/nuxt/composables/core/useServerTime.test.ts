import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);
// The shared setup (test/nuxt/setup.ts) stubs `useServerTime` for every suite;
// this file is the one that tests the real composable, so it opts back in.
vi.unmock('~/composables/core/useServerTime');

describe('useServerTime', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('returns expected API', () => {
		const st = useServerTime();
		expect(st).toHaveProperty('getServerTime');
		expect(st).toHaveProperty('sync');
		expect(st).toHaveProperty('startSync');
		expect(st).toHaveProperty('serverTimeOffset');
		expect(st).toHaveProperty('isSynced');
	});

	it('computes getServerTime as Date.now() + offset', () => {
		const st = useServerTime();
		const now = Date.now();
		// Offset starts at 0, so getServerTime should be close to Date.now()
		const serverTime = st.getServerTime();
		expect(Math.abs(serverTime - now)).toBeLessThan(50);
	});

	it('updates offset after successful sync', async () => {
		const serverTime = Date.now() + 500; // Server is 500ms ahead
		mockFetch.mockResolvedValue({ serverTime });

		const st = useServerTime();
		await st.sync();

		expect(st.isSynced.value).toBe(true);
		// Offset should be approximately 500ms (with RTT compensation)
		expect(st.serverTimeOffset.value).toBeGreaterThan(0);
	});
});
