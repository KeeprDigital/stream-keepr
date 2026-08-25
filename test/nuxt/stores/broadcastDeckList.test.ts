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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
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

	it('does not let a refused optimistic update overwrite peer authority at the same revision', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		const localRequest = deferred<BroadcastDeckListResponse>();
		mockRepo.update.mockReturnValue(localRequest.promise);

		const update = store.updateList(1, original.id, { expectedRevision: 1, name: 'Local edit' });
		const peer = detail({ name: 'Peer edit', revision: 2 });
		mockRepo.list.mockResolvedValue([summary(peer)]);
		mockRepo.getById.mockResolvedValue(peer);
		await store.applyRemoteUpdated({ eventId: 1, listId: original.id, revision: 2 });
		mockRepo.list.mockRejectedValueOnce(new Error('follow-up collection unavailable'));
		mockRepo.getById.mockRejectedValueOnce(new Error('follow-up detail unavailable'));
		localRequest.reject(new Error('revision conflict'));

		await expect(update).rejects.toThrow('revision conflict');
		expect(store.summaries).toEqual([summary(peer)]);
		expect(store.detailById(original.id)).toEqual(peer);
	});

	it('does not let a delayed accepted response overwrite a newer peer revision', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		const localRequest = deferred<BroadcastDeckListResponse>();
		mockRepo.update.mockReturnValue(localRequest.promise);

		const update = store.updateList(1, original.id, { expectedRevision: 1, name: 'Local edit' });
		const peer = detail({ name: 'Peer after accepted edit', revision: 3 });
		mockRepo.list.mockResolvedValue([summary(peer)]);
		mockRepo.getById.mockResolvedValue(peer);
		await store.applyRemoteUpdated({ eventId: 1, listId: original.id, revision: 3 });
		mockRepo.list.mockRejectedValueOnce(new Error('follow-up collection unavailable'));
		mockRepo.getById.mockRejectedValueOnce(new Error('follow-up detail unavailable'));
		localRequest.resolve(detail({ name: 'Local edit', revision: 2 }));

		await update;
		expect(store.summaries).toEqual([summary(peer)]);
		expect(store.detailById(original.id)).toEqual(peer);
	});

	it('invalidates an accepted detail when only a newer peer summary was fetched', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		await store.loadCollection(1);
		const localRequest = deferred<BroadcastDeckListResponse>();
		mockRepo.update.mockReturnValue(localRequest.promise);

		const update = store.updateList(1, original.id, { expectedRevision: 1, name: 'Local edit' });
		const peer = detail({ name: 'Peer after accepted edit', revision: 3 });
		mockRepo.list.mockResolvedValue([summary(peer)]);
		await store.applyRemoteUpdated({ eventId: 1, listId: original.id, revision: 3 });
		mockRepo.list.mockRejectedValueOnce(new Error('follow-up collection unavailable'));
		localRequest.resolve(detail({ name: 'Local edit', revision: 2 }));

		await update;
		expect(store.summaries).toEqual([summary(peer)]);
		expect(store.detailById(original.id)).toBeNull();
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

	it('does not let a refused optimistic delete restore over a peer update', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		const localRequest = deferred<{ success: true }>();
		mockRepo.remove.mockReturnValue(localRequest.promise);

		const remove = store.removeList(1, original.id, 1);
		const peer = detail({ name: 'Peer edit', revision: 2 });
		mockRepo.list.mockResolvedValue([summary(peer)]);
		mockRepo.getById.mockResolvedValue(peer);
		await store.applyRemoteUpdated({ eventId: 1, listId: original.id, revision: 2 });
		mockRepo.list.mockRejectedValueOnce(new Error('follow-up collection unavailable'));
		mockRepo.getById.mockRejectedValueOnce(new Error('follow-up detail unavailable'));
		localRequest.reject(new Error('revision conflict'));

		await expect(remove).rejects.toThrow('revision conflict');
		expect(store.summaries).toEqual([summary(peer)]);
		expect(store.detailById(original.id)).toEqual(peer);
	});

	it('does not report an old Event mutation failure after reset during conflict resync', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		mockRepo.update.mockRejectedValue(new Error('revision conflict'));
		const resyncCollection = deferred<BroadcastDeckListSummaryResponse[]>();
		const resyncDetail = deferred<BroadcastDeckListResponse | null>();
		mockRepo.list.mockReturnValueOnce(resyncCollection.promise);
		mockRepo.getById.mockReturnValueOnce(resyncDetail.promise);

		const update = store.updateList(1, original.id, { expectedRevision: 1, name: 'Local edit' });
		await vi.waitFor(() => expect(mockRepo.list).toHaveBeenCalledTimes(2));
		store.$reset();
		resyncCollection.resolve([summary(original)]);
		resyncDetail.resolve(original);

		await expect(update).rejects.toThrow('revision conflict');
		expect(store.currentEventId).toBeNull();
		expect(store.error).toBeNull();
	});

	it('does not cache a create response after the active Event changes', async () => {
		mockRepo.list.mockResolvedValue([]);
		await store.loadCollection(1);
		const request = deferred<BroadcastDeckListResponse>();
		mockRepo.create.mockReturnValue(request.promise);
		const create = store.createList(1, { name: 'Late', sourceText: '60 Island' });

		await store.loadCollection(2);
		request.resolve(detail({ name: 'Late' }));
		await create;

		expect(store.currentEventId).toBe(2);
		expect(store.summaries).toEqual([]);
		expect(store.details).toEqual(new Map());
	});

	it('does not let a delayed create response overwrite a peer edit already fetched from authority', async () => {
		mockRepo.list.mockResolvedValue([]);
		await store.loadCollection(1);
		const request = deferred<BroadcastDeckListResponse>();
		mockRepo.create.mockReturnValue(request.promise);
		const create = store.createList(1, { name: 'Created revision', sourceText: '60 Island' });
		const peer = detail({ name: 'Peer revision', revision: 2 });
		mockRepo.list.mockResolvedValue([summary(peer)]);

		await store.applyRemoteUpdated({ eventId: 1, listId: peer.id, revision: 2 });
		request.resolve(detail({ name: 'Created revision', revision: 1 }));
		await create;

		expect(store.summaries).toEqual([summary(peer)]);
		expect(store.detailById(peer.id)).toBeNull();
	});

	it('discards collection and detail reads superseded by an authoritative mutation response', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		mockRepo.getById.mockResolvedValue(original);
		await store.loadCollection(1);
		await store.loadDetail(1, original.id);
		const staleCollection = deferred<BroadcastDeckListSummaryResponse[]>();
		const staleDetail = deferred<BroadcastDeckListResponse | null>();
		mockRepo.list.mockReturnValueOnce(staleCollection.promise);
		mockRepo.getById.mockReturnValueOnce(staleDetail.promise);
		const collectionLoad = store.loadCollection(1);
		const detailLoad = store.loadDetail(1, original.id);
		const updated = detail({ name: 'Saved', revision: 2 });
		mockRepo.update.mockResolvedValue(updated);

		await store.updateList(1, original.id, { expectedRevision: 1, name: 'Saved' });
		staleCollection.resolve([summary(original)]);
		staleDetail.resolve(original);
		await Promise.all([collectionLoad, detailLoad]);

		expect(store.summaries).toEqual([summary(updated)]);
		expect(store.detailById(original.id)).toEqual(updated);
	});

	it('refetches a consumed detail after a peer update even while its prior read is pending', async () => {
		const original = detail();
		mockRepo.list.mockResolvedValue([summary(original)]);
		await store.loadCollection(1);
		store.consumeDetail(1, original.id);
		const staleDetail = deferred<BroadcastDeckListResponse | null>();
		mockRepo.getById.mockReturnValueOnce(staleDetail.promise);
		const initialLoad = store.loadDetail(1, original.id);
		const peer = detail({ name: 'Peer edit', revision: 2 });
		mockRepo.list.mockResolvedValue([summary(peer)]);
		mockRepo.getById.mockResolvedValue(peer);

		await store.applyRemoteUpdated({ eventId: 1, listId: original.id, revision: 2 });
		staleDetail.resolve(original);
		await initialLoad;

		expect(store.detailById(original.id)).toEqual(peer);
	});

	it('refetches peer-deleted data from authority and resets all state when the Event changes', async () => {
		const loaded = detail();
		mockRepo.list.mockResolvedValue([summary(loaded)]);
		mockRepo.getById.mockResolvedValue(loaded);
		await store.loadCollection(1);
		await store.loadDetail(1, loaded.id);

		mockRepo.list.mockResolvedValue([]);
		mockRepo.getById.mockResolvedValue(null);
		await store.applyRemoteDeleted({ eventId: 1, listId: loaded.id });
		expect(mockRepo.list).toHaveBeenCalledWith(1);
		expect(mockRepo.getById).toHaveBeenCalledWith(1, loaded.id);
		expect(store.summaries).toEqual([]);
		expect(store.detailById(loaded.id)).toBeNull();

		mockRepo.list.mockResolvedValue([]);
		await store.loadCollection(2);
		expect(store.currentEventId).toBe(2);
		expect(store.details).toEqual(new Map());
	});
});
