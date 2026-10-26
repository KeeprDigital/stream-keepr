import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockPlayerList } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	addMembers: vi.fn(),
	removeMember: vi.fn(),
	batchRemoveMembers: vi.fn(),
	reorderMembers: vi.fn(),
	getMemberIds: vi.fn(),
};

mockNuxtImport('usePlayerListRepository', () => () => mockRepo);

const { deliver } = realtimeHandlersFor();

function createSummary(overrides?: Record<string, any>) {
	return {
		...createMockPlayerList(overrides),
		memberCount: 0,
		...overrides,
	};
}

describe('usePlayerListStore', () => {
	let store: ReturnType<typeof usePlayerListStore>;

	beforeEach(() => {
		store = usePlayerListStore();
		store.$reset();
	});

	it('loads an Event\'s Lists with every List\'s members cached', async () => {
		mockRepo.list.mockResolvedValue([
			createSummary({ id: 1 }),
			createSummary({ id: 2 }),
		]);
		mockRepo.getMemberIds.mockImplementation(async (_eventId: number, listId: number) => [listId * 10]);

		await store.loadByEventId(1);

		expect(store.lists.map(list => list.id)).toEqual([1, 2]);
		expect(store.membersByListId).toEqual(new Map([
			[
				1,
				[10],
			],
			[
				2,
				[20],
			],
		]));
	});

	it('holds a created List with no members', async () => {
		mockRepo.create.mockResolvedValue(createMockPlayerList({ id: 3, name: 'New List' }));

		await store.createList(1, { name: 'New List' });

		expect(store.lists).toEqual([
			expect.objectContaining({ id: 3, memberCount: 0 }),
		]);
	});

	describe('removeList', () => {
		it('drops the List and its cached members', async () => {
			store.lists = [
				createSummary({ id: 1 }),
			];
			store.membersByListId.set(1, [10, 20]);
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeList(1, 1);

			expect(store.lists).toEqual([]);
			expect(store.membersByListId.has(1)).toBe(false);
		});

		it('puts the List and its cached members back when the delete is refused', async () => {
			store.lists = [
				createSummary({ id: 1 }),
			];
			store.membersByListId.set(1, [10, 20]);
			mockRepo.remove.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'The List is in use' },
			}));

			await store.removeList(1, 1);

			expect(store.lists.map(list => list.id)).toEqual([1]);
			expect(store.membersByListId.get(1)).toEqual([10, 20]);
			expect(store.error).toBe('The List is in use');
		});
	});

	describe('member writes', () => {
		it('adding counts and caches the new members while the request is pending, then takes the server\'s count', async () => {
			store.lists = [
				createSummary({ id: 1, memberCount: 2 }),
			];
			store.membersByListId.set(1, [10, 20]);
			const added = deferred<{ added: number; memberCount: number }>();
			mockRepo.addMembers.mockReturnValueOnce(added.promise);

			const adding = store.addMembers(1, 1, [20, 30]);

			expect(mockRepo.addMembers).toHaveBeenCalledWith(1, 1, [30]);
			expect(store.lists[0]!.memberCount).toBe(3);
			expect(store.membersByListId.get(1)).toEqual([10, 20, 30]);

			added.resolve({ added: 1, memberCount: 7 });
			await adding;

			expect(store.lists[0]!.memberCount).toBe(7);
		});

		it('adding only members the List already caches sends nothing', async () => {
			store.lists = [
				createSummary({ id: 1, memberCount: 2 }),
			];
			store.membersByListId.set(1, [10, 20]);

			await store.addMembers(1, 1, [10]);

			expect(mockRepo.addMembers).not.toHaveBeenCalled();
			expect(store.lists[0]!.memberCount).toBe(2);
		});

		it('removing a member uncounts and uncaches it', async () => {
			store.lists = [
				createSummary({ id: 1, memberCount: 3 }),
			];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo.removeMember.mockResolvedValue({ success: true, memberCount: 2 });

			await store.removeMember(1, 1, 10);

			expect(store.lists[0]!.memberCount).toBe(2);
			expect(store.membersByListId.get(1)).toEqual([20, 30]);
		});

		it('reordering holds the new order', async () => {
			store.lists = [
				createSummary({ id: 1, memberCount: 3 }),
			];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo.reorderMembers.mockResolvedValue({ reordered: 3, memberCount: 3 });

			await store.reorderMembers(1, 1, [30, 20, 10]);

			expect(store.membersByListId.get(1)).toEqual([30, 20, 10]);
		});

		it('loading a List\'s members caches them', async () => {
			mockRepo.getMemberIds.mockResolvedValue([5, 10, 15]);

			await store.loadListMembers(1, 42);

			expect(store.membersByListId.get(42)).toEqual([5, 10, 15]);
		});
	});

	describe.each([
		[
			'adding',
			'addMembers',
			(s: ReturnType<typeof usePlayerListStore>) => s.addMembers(1, 1, [40]),
		],
		[
			'removing',
			'removeMember',
			(s: ReturnType<typeof usePlayerListStore>) => s.removeMember(1, 1, 10),
		],
		[
			'batch removing',
			'batchRemoveMembers',
			(s: ReturnType<typeof usePlayerListStore>) => s.batchRemoveMembers(1, 1, [10, 20]),
		],
		[
			'reordering',
			'reorderMembers',
			(s: ReturnType<typeof usePlayerListStore>) => s.reorderMembers(1, 1, [30, 20, 10]),
		],
	] as const)('a refused member write (%s)', (_, method, write) => {
		it('reports the server\'s sentence and rolls the count and cached members back', async () => {
			store.lists = [
				createSummary({ id: 1, memberCount: 3 }),
			];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo[method].mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'This list is locked for the current round' },
			}));

			await write(store);

			expect(store.error).toBe('This list is locked for the current round');
			expect(store.lists[0]!.memberCount).toBe(3);
			expect(store.membersByListId.get(1)).toEqual([10, 20, 30]);
		});
	});

	describe('a peer\'s Player List messages', () => {
		it('add, merge and remove Lists, dropping a removed List\'s cached members', () => {
			deliver('playerList:created', {
				playerList: { id: 10, name: 'Remote List' },
			} as never);

			expect(store.lists).toEqual([
				expect.objectContaining({ id: 10, memberCount: 0 }),
			]);

			deliver('playerList:updated', {
				playerList: { id: 10, name: 'Renamed' },
			} as never);

			expect(store.lists[0]).toEqual(expect.objectContaining({ name: 'Renamed', memberCount: 0 }));

			store.membersByListId.set(10, [1, 2]);
			deliver('playerList:deleted', { listId: 10 });

			expect(store.lists).toEqual([]);
			expect(store.membersByListId.has(10)).toBe(false);
		});

		it('take the authoritative member count and drop the cached members', () => {
			store.lists = [
				createSummary({ id: 10, memberCount: 2 }),
			];
			store.membersByListId.set(10, [1, 2]);

			deliver('playerList:membersChanged', {
				listId: 10,
				action: 'added',
				playerIds: [3],
				memberCount: 8,
			} as never);

			expect(store.lists[0]!.memberCount).toBe(8);
			expect(store.membersByListId.has(10)).toBe(false);
		});
	});

	it('forgets cached members on reset', () => {
		store.membersByListId.set(1, [10]);

		store.$reset();

		expect(store.membersByListId.size).toBe(0);
	});

	// A write is answered for the Event it was made in; neither its answer nor its rollback lands in another (#606).
	describe.each([
		[
			'Event B',
			[2],
		],
		[
			'Event A, loaded again since',
			[2, 1],
		],
	])('a Player List write answered after the operator moved on to %s', (_, switches) => {
		/** Ends on Lists 1 and 2 with members cached, as Event A's own are when loaded again. */
		async function switchAway() {
			for (const eventId of switches) {
				store.$reset();
				mockRepo.list.mockResolvedValueOnce([
					createSummary({ id: 1, eventId, memberCount: 5 }),
					createSummary({ id: 2, eventId, memberCount: 9 }),
				]);
				mockRepo.getMemberIds.mockResolvedValue([7]);
				await store.loadByEventId(eventId);
			}
			return {
				lists: structuredClone(toRaw(store.lists)),
				members: new Map(store.membersByListId),
			};
		}

		function inEventA() {
			store.lists = [
				createSummary({ id: 2, memberCount: 1 }),
				createSummary({ id: 1, memberCount: 2 }),
			];
			store.membersByListId.set(1, [10, 20]);
			store.membersByListId.set(2, [30]);
		}

		it('late member writes change no List and no cached members, whether they succeed or fail', async () => {
			inEventA();
			const added = deferred<{ added: number; memberCount: number }>();
			const removed = deferred<never>();
			const batchRemoved = deferred<never>();
			const reordered = deferred<never>();
			mockRepo.addMembers.mockReturnValueOnce(added.promise);
			mockRepo.removeMember.mockReturnValueOnce(removed.promise);
			mockRepo.batchRemoveMembers.mockReturnValueOnce(batchRemoved.promise);
			mockRepo.reorderMembers.mockReturnValueOnce(reordered.promise);

			const writes = [
				store.addMembers(1, 1, [40]),
				store.removeMember(1, 2, 30),
				store.batchRemoveMembers(1, 1, [10]),
				store.reorderMembers(1, 1, [20, 10]),
			];
			const shown = await switchAway();
			added.resolve({ added: 1, memberCount: 3 });
			removed.reject(new Error('Remove refused'));
			batchRemoved.reject(new Error('Batch remove refused'));
			reordered.reject(new Error('Reorder refused'));
			await Promise.all(writes);

			expect(store.lists).toEqual(shown.lists);
			expect(store.membersByListId).toEqual(shown.members);
			expect(store.error).toBeNull();
		});

		it('a late failed List delete puts back no List and no cached members', async () => {
			inEventA();
			const remove = deferred<never>();
			mockRepo.remove.mockReturnValueOnce(remove.promise);

			const removing = store.removeList(1, 1);
			const shown = await switchAway();
			remove.reject(new Error('Delete refused'));
			await removing;

			expect(store.lists).toEqual(shown.lists);
			expect(store.membersByListId).toEqual(shown.members);
			expect(store.error).toBeNull();
		});

		it('a late member read caches nothing', async () => {
			const read = deferred<number[]>();
			mockRepo.getMemberIds.mockReturnValueOnce(read.promise);

			const reading = store.loadListMembers(1, 1);
			const shown = await switchAway();
			read.resolve([10, 20]);
			await reading;

			expect(store.membersByListId).toEqual(shown.members);
		});
	});
});
