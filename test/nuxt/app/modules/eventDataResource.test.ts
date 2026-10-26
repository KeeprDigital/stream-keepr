import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventDataResource } from '~~/app/modules/event-data/client';

// Path building, list normalization and origin headers are the client module's own
// (test/unit/app/modules/eventDataClient.test.ts); this is the resource's wiring of them.

const mockApiHeaders = {
	getHeaders: vi.fn(() => ({ 'x-realtime-connection-id': 'test-connection-id' })),
};
mockNuxtImport('useApiHeaders', () => () => mockApiHeaders);

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

describe('useEventDataResource', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({});
	});

	it('lists an Event\'s resource, normalized to its items', async () => {
		mockFetch.mockResolvedValue({
			players: [
				{ id: 1 },
			],
			total: 1,
		});

		const items = await useEventDataResource({ resourcePath: 'players', eventScoped: true }).list(1);

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players');
		expect(items).toEqual([
			{ id: 1 },
		]);
	});

	it('lists a resource outside any Event', async () => {
		await useEventDataResource({ resourcePath: 'events', eventScoped: false }).list(null);

		expect(mockFetch).toHaveBeenCalledWith('/api/events');
	});

	it.each([
		[
			'reads one',
			(repo: ReturnType<typeof useEventDataResource>) => repo.getById(1, 42),
			'/api/events/1/players/42',
			undefined,
		],
		[
			'creates',
			(repo: ReturnType<typeof useEventDataResource>) => repo.create(1, { name: 'New' }),
			'/api/events/1/players',
			{
				method: 'POST',
				body: { name: 'New' },
			},
		],
		[
			'updates',
			(repo: ReturnType<typeof useEventDataResource>) => repo.update(1, 42, { name: 'Renamed' }),
			'/api/events/1/players/42',
			{
				method: 'PATCH',
				body: { name: 'Renamed' },
			},
		],
		[
			'removes',
			(repo: ReturnType<typeof useEventDataResource>) => repo.remove(1, 42),
			'/api/events/1/players/42',
			{ method: 'DELETE' },
		],
	])('%s through the resource path', async (_, call, path, options) => {
		await call(useEventDataResource({ resourcePath: 'players', eventScoped: true }));

		expect(mockFetch).toHaveBeenCalledWith(...(options
			? [path, options]
			: [path]));
	});

	it('sends realtime-origin headers with a write when asked to', async () => {
		await useEventDataResource({ resourcePath: 'players', includeHeaders: true }).create(1, { name: 'New' });

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players', expect.objectContaining({
			headers: { 'x-realtime-connection-id': 'test-connection-id' },
		}));
	});
});
