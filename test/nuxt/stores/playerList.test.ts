import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlayerList } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Dependencies ──

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

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

mockNuxtImport('usePlayerListRepository', () => () => mockRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);

function createSummary(overrides?: Record<string, any>) {
	return { ...createMockPlayerList(overrides), memberCount: 0, ...overrides };
}

describe('usePlayerListStore', () => {
	let store: ReturnType<typeof usePlayerListStore>;

	beforeEach(() => {
		store = usePlayerListStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.playerList = {
			'playerList:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'playerList:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'playerList:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
			'playerList:membersChanged': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteMembersChanged(data as any),
		};
	});

	// ── Loading ──

	describe('loadByEventId', () => {
		it('populates lists state and preloads members', async () => {
			const lists = [
				createSummary({ id: 1, name: 'List 1' }),
				createSummary({ id: 2, name: 'List 2' }),
			];
			mockRepo.list.mockResolvedValue(lists);
			mockRepo.getMemberIds.mockResolvedValue([]);

			await store.loadByEventId(1);

			expect(store.lists).toEqual(lists);
			expect(store.isLoaded).toBe(true);
			expect(mockRepo.getMemberIds).toHaveBeenCalledTimes(2);
		});
	});

	// ── Create ──

	describe('createList', () => {
		it('adds list to state with memberCount 0', async () => {
			const created = createMockPlayerList({ id: 3, name: 'New List' });
			mockRepo.create.mockResolvedValue(created);

			await store.createList(1, { name: 'New List' });

			expect(store.lists).toHaveLength(1);
			expect(store.lists[0]!.name).toBe('New List');
			expect(store.lists[0]!.memberCount).toBe(0);
		});
	});

	// ── Update (optimistic) ──

	describe('updateList', () => {
		it('optimistically updates then applies server response', async () => {
			store.lists = [createSummary({ id: 1, name: 'Old Name' })];

			const serverUpdated = createMockPlayerList({ id: 1, name: 'Server Name' });
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateList(1, 1, { name: 'New Name' });

			expect(store.lists[0]!.name).toBe('Server Name');
		});
	});

	// ── Remove (optimistic) ──

	describe('removeList', () => {
		it('removes list from state and clears member cache', async () => {
			store.lists = [createSummary({ id: 1 })];
			store.membersByListId.set(1, [10, 20]);
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeList(1, 1);

			expect(store.lists).toHaveLength(0);
			expect(store.membersByListId.has(1)).toBe(false);
		});

		it('returns null and sets error when list not found', async () => {
			store.lists = [];

			const result = await store.removeList(1, 999);

			expect(result).toBeNull();
			expect(store.error).toBe('Player list not found');
		});
	});

	// ── Member Management ──

	describe('addMembers', () => {
		it('optimistically increments member count', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 2 })];
			store.membersByListId.set(1, [10, 20]);
			mockRepo.addMembers.mockResolvedValue({ added: 1, memberCount: 3 });

			await store.addMembers(1, 1, [30]);

			expect(store.lists[0]!.memberCount).toBe(3);
		});

		it('corrects member count when server added fewer than expected', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 2 })];
			mockRepo.addMembers.mockResolvedValue({ added: 1, memberCount: 3 });

			await store.addMembers(1, 1, [30, 40]);

			expect(store.lists[0]!.memberCount).toBe(3);
		});
	});

	describe('removeMember', () => {
		it('optimistically decrements member count', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 3 })];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo.removeMember.mockResolvedValue({ success: true, memberCount: 2 });

			await store.removeMember(1, 1, 10);

			expect(store.lists[0]!.memberCount).toBe(2);
			expect(store.membersByListId.get(1)).toEqual([20, 30]);
		});

		it('handles list not found (index -1) gracefully', async () => {
			store.lists = [];
			store.membersByListId.set(1, [10, 20]);
			mockRepo.removeMember.mockResolvedValue({ success: true, memberCount: 1 });

			await store.removeMember(1, 1, 10);

			expect(store.membersByListId.get(1)).toEqual([20]);
		});
	});

	describe('reorderMembers', () => {
		it('optimistically updates cached member order', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 3 })];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo.reorderMembers.mockResolvedValue({ reordered: 3, memberCount: 3 });

			await store.reorderMembers(1, 1, [30, 20, 10]);

			expect(store.membersByListId.get(1)).toEqual([30, 20, 10]);
		});
	});

	// ── Member Mutation Failures ──

	/**
	 * What the Player List pane shows when a member mutation is refused.
	 *
	 * The Player List store's own lifecycle already reported the server's sentence (#262),
	 * but its member Module did not — so adding a player to a list said
	 * '[POST] "…": 409 Conflict' while creating the list said why. These rows also could
	 * not exist before #271: this suite stood a hand-written `useAsyncAction` in for the
	 * real one that re-threw every failure and never wrote `errorRef`, so nothing here had
	 * ever observed what an operator is told (#263's map, #241's discipline).
	 */
	describe('member mutation failures', () => {
		it('reports the sentence and rolls the optimistic count back when adding is refused', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 2 })];
			store.membersByListId.set(1, [10, 20]);
			mockRepo.addMembers.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'That player is already on another list for this round' },
			}));

			await store.addMembers(1, 1, [30]);

			expect(store.error).toBe('That player is already on another list for this round');
			expect(store.lists[0]!.memberCount).toBe(2);
			expect(store.membersByListId.get(1)).toEqual([10, 20]);
		});

		it('reports the sentence when removing a member is refused', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 3 })];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo.removeMember.mockRejectedValue(transportFailure({
				status: 403,
				body: { message: 'This list is locked for the current round' },
			}));

			await store.removeMember(1, 1, 10);

			expect(store.error).toBe('This list is locked for the current round');
			expect(store.lists[0]!.memberCount).toBe(3);
			expect(store.membersByListId.get(1)).toEqual([10, 20, 30]);
		});

		it('reports the sentence when a batch removal is refused', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 3 })];
			mockRepo.batchRemoveMembers.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'Two of those players have already been dropped' },
			}));

			await store.batchRemoveMembers(1, 1, [10, 20]);

			expect(store.error).toBe('Two of those players have already been dropped');
			expect(store.lists[0]!.memberCount).toBe(3);
		});

		it('reports the sentence and restores the order when a reorder is refused', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 3 })];
			store.membersByListId.set(1, [10, 20, 30]);
			mockRepo.reorderMembers.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'The list was reordered by another operator' },
			}));

			await store.reorderMembers(1, 1, [30, 20, 10]);

			expect(store.error).toBe('The list was reordered by another operator');
			expect(store.membersByListId.get(1)).toEqual([10, 20, 30]);
		});

		it('reports the sentence when loading members is refused', async () => {
			mockRepo.getMemberIds.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'That Player List has been deleted' },
				request: `[GET] "/api/events/1/player-lists/42/members"`,
			}));

			await store.loadListMembers(1, 42);

			expect(store.error).toBe('That Player List has been deleted');
		});

		it('shows the transport line rather than a 5xx body detail', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 2 })];
			mockRepo.addMembers.mockRejectedValue(transportFailure({
				status: 500,
				body: { message: 'D1_ERROR: no such table: player_list_members' },
				request: `[POST] "/api/events/1/player-lists/1/members"`,
			}));

			await store.addMembers(1, 1, [30]);

			expect(store.error).not.toContain('D1_ERROR');
			expect(store.error).toBe('[POST] "/api/events/1/player-lists/1/members": 500 Internal Server Error');
		});

		it('reports a rejection that is not an Error as the composable does', async () => {
			store.lists = [createSummary({ id: 1, memberCount: 2 })];
			mockRepo.addMembers.mockRejectedValue({ message: 'not an Error at all' });

			await store.addMembers(1, 1, [30]);

			expect(store.error).toBe('An error occurred');
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('playerList:created', () => {
			it('adds list from remote message', () => {
				store.lists = [];

				ablyCallbacks.playerList!['playerList:created']!({ playerList: { id: 10, name: 'Remote List', memberCount: 0 } });

				expect(store.lists).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				store.lists = [];

				ablyCallbacks.playerList!['playerList:created']!({ playerList: { id: 10, name: 'Remote List', memberCount: 0 } });

				expect(store.lists).toHaveLength(0);
			});
		});

		describe('playerList:updated', () => {
			it('updates existing list from remote message', () => {
				store.lists = [createSummary({ id: 10, name: 'Old' })];

				ablyCallbacks.playerList!['playerList:updated']!({ playerList: { id: 10, name: 'New' } });

				expect(store.lists[0]!.name).toBe('New');
			});

			it('skips when isSelfOrigin returns true', () => {
				store.lists = [createSummary({ id: 10, name: 'Old' })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.playerList!['playerList:updated']!({ playerList: { id: 10, name: 'New' } });

				expect(store.lists[0]!.name).toBe('Old');
			});
		});

		describe('playerList:deleted', () => {
			it('removes list and member cache from remote message', () => {
				store.lists = [createSummary({ id: 10 })];
				store.membersByListId.set(10, [1, 2]);

				ablyCallbacks.playerList!['playerList:deleted']!({ listId: 10 });

				expect(store.lists).toHaveLength(0);
				expect(store.membersByListId.has(10)).toBe(false);
			});
		});

		describe('playerList:membersChanged', () => {
			it('sets authoritative count on added action', () => {
				store.lists = [createSummary({ id: 10, memberCount: 2 })];

				ablyCallbacks.playerList!['playerList:membersChanged']!({ listId: 10, action: 'added', playerIds: [1, 2, 3], memberCount: 8 });

				expect(store.lists[0]!.memberCount).toBe(8);
			});

			it('invalidates member cache on any change', () => {
				store.lists = [createSummary({ id: 10 })];
				store.membersByListId.set(10, [1, 2]);

				ablyCallbacks.playerList!['playerList:membersChanged']!({ listId: 10, action: 'reordered', playerIds: [2, 1], memberCount: 2 });

				expect(store.membersByListId.has(10)).toBe(false);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.lists = [createSummary({ id: 10, memberCount: 2 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.playerList!['playerList:membersChanged']!({ listId: 10, action: 'added', playerIds: [1], memberCount: 3 });

				expect(store.lists[0]!.memberCount).toBe(2);
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.lists = [createSummary()];
			store.membersByListId.set(1, [10]);
			store.error = 'some error';

			store.$reset();

			expect(store.lists).toEqual([]);
			expect(store.membersByListId.size).toBe(0);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.isLoaded).toBe(false);
		});
	});

	// ── loadListMembers ──

	describe('loadListMembers', () => {
		it('fetches and caches member IDs for a list', async () => {
			mockRepo.getMemberIds.mockResolvedValue([5, 10, 15]);

			await store.loadListMembers(1, 42);

			expect(store.membersByListId.get(42)).toEqual([5, 10, 15]);
		});
	});
});
