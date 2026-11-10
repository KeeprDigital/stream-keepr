import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { ScreenLookupUnavailable } from '~/composables/repositories/useScreenRepository';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useRealtime', () => () => createMockRealtime());

// A Screen Output reads on the capability surface: an unattended output presents its
// capability as a bearer; a preview embed holds none and rides on its operator's session.
const reads = [
	{
		name: 'the Screen by slug',
		path: '/api/screen-output/events/1/screens/slug/main',
		read: (capability: string | null | undefined) => useScreenRepository().getBySlug(1, 'main', capability ?? undefined),
	},
	{
		name: 'the selected Broadcast Deck List',
		path: '/api/screen-output/events/1/screens/7/broadcast-deck-list',
		read: (capability: string | null | undefined) => useScreenOutputBroadcastDeckListRepository().getSelected(1, 7, capability ?? null),
	},
];

describe('screen Output capability reads', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({ id: 1 });
	});

	it.each(reads)('reads $name with the capability as a bearer', async ({ path, read }) => {
		await read('a-screen-output-capability-token');

		expect(mockFetch).toHaveBeenCalledWith(path, {
			headers: { authorization: 'Bearer a-screen-output-capability-token' },
		});
	});

	it.each(reads)('reads $name with no authorization when the embed holds no capability', async ({ path, read }) => {
		await read(null);

		expect(mockFetch).toHaveBeenCalledWith(path, { headers: undefined });
	});

	it('answers a refused Screen read with nothing to tell apart from a missing Screen', async () => {
		mockFetch.mockRejectedValue(Object.assign(new Error('Not Found'), { statusCode: 404 }));

		await expect(useScreenRepository().getBySlug(1, 'main', 'a-capability-for-another-screen')).resolves.toBeNull();
	});

	// A lookup that could not be answered is not a missing Screen: its caller
	// retries the one and gives up on the other.
	it.each([
		{
			failure: 'a 503',
			error: Object.assign(new Error('Service Unavailable'), { statusCode: 503 }),
		},
		{
			failure: 'no answer at all',
			error: new TypeError('Failed to fetch'),
		},
	])('says the Screen lookup is unavailable on $failure', async ({ error }) => {
		mockFetch.mockRejectedValue(error);

		await expect(useScreenRepository().getBySlug(1, 'main', 'a-capability')).rejects.toBeInstanceOf(ScreenLookupUnavailable);
	});
});
