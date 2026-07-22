import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventDataResource } from '~~/app/modules/event-data/client';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const mockAbly = createMockRealtime();
mockNuxtImport('useRealtime', () => () => mockAbly);
const mockApiHeaders = {
	getHeaders: vi.fn(() => ({ 'x-realtime-connection-id': 'test-connection-id' })),
};
mockNuxtImport('useApiHeaders', () => () => mockApiHeaders);

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

describe('useEventDataResource', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAbly.connectionId = 'test-connection-id';
	});

	describe('path construction', () => {
		it('builds event-scoped paths', () => {
			const repo = useEventDataResource({ resourcePath: 'players', eventScoped: true });
			// Exercise list to trigger buildPath
			mockFetch.mockResolvedValue([]);
			void repo.list(1);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players');
		});

		it('builds non-event-scoped paths', () => {
			const repo = useEventDataResource({ resourcePath: 'events', eventScoped: false });
			mockFetch.mockResolvedValue([]);
			void repo.list(null);
			expect(mockFetch).toHaveBeenCalledWith('/api/events');
		});

		it('appends resource ID to path', () => {
			const repo = useEventDataResource({ resourcePath: 'players', eventScoped: true });
			mockFetch.mockResolvedValue({});
			void repo.getById(1, 42);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/42');
		});
	});

	describe('list', () => {
		it('returns array responses directly', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			const players = [{ id: 1, name: 'A' }];
			mockFetch.mockResolvedValue(players);
			const result = await repo.list(1);
			expect(result).toEqual(players);
		});

		it('extracts items from object responses using resourcePath key', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			mockFetch.mockResolvedValue({ players: [{ id: 1 }], total: 1 });
			const result = await repo.list(1);
			expect(result).toEqual([{ id: 1 }]);
		});

		it('returns empty array for unrecognized response shapes', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			mockFetch.mockResolvedValue({ unknown: 'data' });
			const result = await repo.list(1);
			expect(result).toEqual([]);
		});
	});

	describe('getById', () => {
		it('returns the fetched entity', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			const player = { id: 1, name: 'Test' };
			mockFetch.mockResolvedValue(player);
			const result = await repo.getById(1, 1);
			expect(result).toEqual(player);
		});
	});

	describe('create', () => {
		it('sends POST request with body', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			const data = { name: 'New Player' };
			mockFetch.mockResolvedValue({ id: 1, ...data });
			await repo.create(1, data);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players', {
				method: 'POST',
				body: data,
			});
		});

		it('includes headers when includeHeaders is true', async () => {
			const repo = useEventDataResource({ resourcePath: 'players', includeHeaders: true });
			const data = { name: 'New Player' };
			mockFetch.mockResolvedValue({ id: 1, ...data });
			await repo.create(1, data);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players', expect.objectContaining({
				method: 'POST',
				body: data,
				headers: { 'x-realtime-connection-id': 'test-connection-id' },
			}));
		});
	});

	describe('update', () => {
		it('sends PATCH request with body', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			const data = { name: 'Updated' };
			mockFetch.mockResolvedValue({ id: 1, ...data });
			await repo.update(1, 1, data);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/1', {
				method: 'PATCH',
				body: data,
			});
		});
	});

	describe('remove', () => {
		it('sends DELETE request', async () => {
			const repo = useEventDataResource({ resourcePath: 'players' });
			mockFetch.mockResolvedValue({ success: true });
			await repo.remove(1, 1);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/1', {
				method: 'DELETE',
			});
		});
	});
});
