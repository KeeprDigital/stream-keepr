import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive } from 'vue';
import { eventDataResync } from '~/modules/event-data/resync';

/**
 * A metagame page's summary and section are its own reads, held by no store, so
 * the page re-runs them on Reconnect Resync rather than waiting for a Player
 * re-read to bump the roster version.
 */

const mockMetagameStore = reactive({
	scope: 'all',
	topN: 8,
	minPoints: 0,
	playerListId: null,
	conversionMetric: 'top8',
	conversionThreshold: 0,
	invalidationVersion: 0,
	error: null as string | null,
	loadSummary: vi.fn(async () => {}),
});

mockNuxtImport('useEventStore', () => () => ({ eventId: 12 }));
mockNuxtImport('usePlayerStore', () => () => ({ dataVersion: 0 }));
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('useRequestFeedback', () => () => ({
	runRequest: async (request: () => Promise<unknown>) => request(),
}));

describe('useMetagamePage', () => {
	afterEach(() => {
		eventDataResync.reset();
	});

	it('re-reads its summary and section on Reconnect Resync while mounted (#610)', async () => {
		const fetchSection = vi.fn(async () => {});
		const page = effectScope();
		page.run(() => useMetagamePage(fetchSection));

		await eventDataResync.resync();
		expect(mockMetagameStore.loadSummary).toHaveBeenCalledWith(12);
		expect(fetchSection).toHaveBeenCalledOnce();

		vi.clearAllMocks();
		page.stop();
		await eventDataResync.resync();
		expect(mockMetagameStore.loadSummary).not.toHaveBeenCalled();
		expect(fetchSection).not.toHaveBeenCalled();
	});
});
