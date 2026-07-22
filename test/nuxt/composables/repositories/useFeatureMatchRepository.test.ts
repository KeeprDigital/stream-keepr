import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

const mockApiHeaders = {
	getHeaders: vi.fn(() => ({ 'x-realtime-connection-id': 'test-connection-id' })),
};

mockNuxtImport('useRealtime', () => () => createMockRealtime());
mockNuxtImport('useApiHeaders', () => () => mockApiHeaders);

describe('useFeatureMatchRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists slots using the slot response key', async () => {
		const matches = [{ id: 1 }, { id: 2 }];
		mockFetch.mockResolvedValue({ featureMatchSlots: matches });
		const repo = useFeatureMatchRepository();
		const result = await repo.list(1);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots');
		expect(result).toEqual(matches);
	});

	it('updates slot setup with origin headers', async () => {
		const data = { bestOf: 5 };
		mockFetch.mockResolvedValue({ id: 1, ...data });
		const repo = useFeatureMatchRepository();
		await repo.update(1, 1, data as any);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots/1/setup', {
			method: 'PATCH',
			body: data,
			headers: { 'x-realtime-connection-id': 'test-connection-id' },
		});
	});

	it('reorder sends origin headers for realtime self-origin filtering', async () => {
		const repo = useFeatureMatchRepository();
		await repo.reorder(1, 3, 'up');

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots/reorder', {
			method: 'PATCH',
			body: { slotId: 3, direction: 'up' },
			headers: { 'x-realtime-connection-id': 'test-connection-id' },
		});
	});

	it('promotes a Match through the Feature Match Slot command', async () => {
		const response = {
			promotedSlot: { id: 3, matchId: 7 },
			clearedSlots: [],
			assignment: { id: 11, roundId: 2, slotId: 3, matchId: 7 },
		};
		mockFetch.mockResolvedValue(response);
		const repo = useFeatureMatchRepository();
		const result = await repo.promoteMatch(1, 3, 7);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots/3/promote', {
			method: 'POST',
			body: { matchId: 7 },
			headers: { 'x-realtime-connection-id': 'test-connection-id' },
		});
		expect(result).toEqual(response);
	});
});
