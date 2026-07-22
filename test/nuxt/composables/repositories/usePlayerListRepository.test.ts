import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useRealtime', () => () => createMockRealtime());

describe('usePlayerListRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('gets player list by id with custom $fetch', async () => {
		const list = { id: 1, name: 'List 1', members: [] };
		mockFetch.mockResolvedValue(list);
		const repo = usePlayerListRepository();

		const result = await repo.getById(1, 1);
		expect(result).toEqual(list);
	});

	it('adds members with POST', async () => {
		mockFetch.mockResolvedValue({ added: 3 });
		const repo = usePlayerListRepository();

		await repo.addMembers(1, 1, [1, 2, 3]);
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/events/1/player-lists/1/members',
			expect.objectContaining({
				method: 'POST',
				body: { playerIds: [1, 2, 3] },
			}),
		);
	});

	it('removes a member with DELETE', async () => {
		mockFetch.mockResolvedValue({ success: true });
		const repo = usePlayerListRepository();

		await repo.removeMember(1, 1, 5);
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/events/1/player-lists/1/members/5',
			expect.objectContaining({ method: 'DELETE' }),
		);
	});

	it('reorders members with PUT', async () => {
		mockFetch.mockResolvedValue({ reordered: 3 });
		const repo = usePlayerListRepository();

		await repo.reorderMembers(1, 1, [3, 1, 2]);
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/events/1/player-lists/1/members/reorder',
			expect.objectContaining({
				method: 'PUT',
				body: { playerIds: [3, 1, 2] },
			}),
		);
	});

	it('gets member IDs', async () => {
		mockFetch.mockResolvedValue({ memberIds: [1, 2, 3] });
		const repo = usePlayerListRepository();

		const result = await repo.getMemberIds(1, 1);
		expect(result).toEqual([1, 2, 3]);
	});
});
