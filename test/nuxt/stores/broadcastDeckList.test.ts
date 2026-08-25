import type { BroadcastDeckListResponse, BroadcastDeckListSummaryResponse } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};

mockNuxtImport('useBroadcastDeckListRepository', () => () => mockRepo);

function detail(overrides: Partial<BroadcastDeckListResponse> = {}): BroadcastDeckListResponse {
	return {
		id: 11,
		eventId: 1,
		name: 'Deck',
		archetypeLabel: null,
		colors: 'U',
		revision: 1,
		mainboardQuantity: 60,
		sideboardQuantity: 15,
		hasCompanion: false,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		sourceText: '60 Island',
		entries: [],
		...overrides,
	};
}

function summary(value: BroadcastDeckListResponse): BroadcastDeckListSummaryResponse {
	const { sourceText: _sourceText, entries: _entries, ...result } = value;
	return result;
}

describe('useBroadcastDeckListStore', () => {
	let store: ReturnType<typeof useBroadcastDeckListStore>;

	beforeEach(() => {
		store = useBroadcastDeckListStore();
		store.$reset();
		vi.clearAllMocks();
	});

	it('loads summaries and caches a consumed detail', async () => {
		const loaded = detail();
		mockRepo.list.mockResolvedValue([summary(loaded)]);
		mockRepo.getById.mockResolvedValue(loaded);

		store.consumeDetail(1, loaded.id);
		await store.loadCollection(1);
		await store.loadDetail(1, loaded.id);

		expect(store.summaries).toEqual([summary(loaded)]);
		expect(store.detailById(loaded.id)).toEqual(loaded);
	});

	it('refetches authoritative collection and a cached detail after a peer update', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		store.consumeDetail(1, original.id);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);

		const authoritative = detail({ name: 'Peer edit', revision: 2 });
		mockRepo.list.mockResolvedValue([summary(authoritative)]);
		mockRepo.getById.mockResolvedValue(authoritative);
		const refresh = store.applyRemoteUpdated({ eventId: 1, listId: original.id, revision: 2 });

		expect(store.detailById(original.id)?.name).toBe('Deck');
		await refresh;
		expect(store.detailById(original.id)).toEqual(authoritative);
	});

	it('reconnects by reloading the collection and only currently consumed details', async () => {
		const first = detail();
		const second = detail({ id: 22, name: 'Second' });
		mockRepo.list.mockResolvedValue([summary(first), summary(second)]);
		mockRepo.getById.mockImplementation(async (_eventId: number, id: number) => id === first.id ? first : second);
		const releaseFirst = store.consumeDetail(1, first.id);
		store.consumeDetail(1, second.id);
		await store.loadCollection(1);
		await store.loadDetail(1, first.id);
		await store.loadDetail(1, second.id);
		releaseFirst();
		vi.clearAllMocks();
		mockRepo.list.mockResolvedValue([summary(first), summary(second)]);
		mockRepo.getById.mockResolvedValue(second);

		await store.reloadAuthoritativeState();

		expect(mockRepo.list).toHaveBeenCalledWith(1);
		expect(mockRepo.getById).toHaveBeenCalledOnce();
		expect(mockRepo.getById).toHaveBeenCalledWith(1, second.id);
	});

	it('rolls back an optimistic revisioned update when the server refuses it', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		mockRepo.update.mockRejectedValue(new Error('revision conflict'));

		const update = store.updateList(1, original.id, { expectedRevision: 1, name: 'Optimistic' });
		expect(store.detailById(original.id)?.name).toBe('Optimistic');
		await expect(update).rejects.toThrow('revision conflict');
		expect(store.detailById(original.id)).toEqual(original);
		expect(store.summaries).toEqual([summary(original)]);
	});

	it('rolls back an optimistic delete when the server refuses it', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		mockRepo.remove.mockRejectedValue(new Error('revision conflict'));

		const remove = store.removeList(1, original.id, 1);
		expect(store.summaries).toEqual([]);
		expect(store.detailById(original.id)).toBeNull();
		await expect(remove).rejects.toThrow('revision conflict');
		expect(store.summaries).toEqual([summary(original)]);
		expect(store.detailById(original.id)).toEqual(original);
	});

	it('removes peer-deleted data and resets all state when the Event changes', async () => {
		const loaded = detail();
		mockRepo.list.mockResolvedValue([summary(loaded)]);
		mockRepo.getById.mockResolvedValue(loaded);
		await store.loadCollection(1);
		await store.loadDetail(1, loaded.id);

		store.applyRemoteDeleted({ eventId: 1, listId: loaded.id });
		expect(store.summaries).toEqual([]);
		expect(store.detailById(loaded.id)).toBeNull();

		mockRepo.list.mockResolvedValue([]);
		await store.loadCollection(2);
		expect(store.currentEventId).toBe(2);
		expect(store.details).toEqual(new Map());
	});
});
