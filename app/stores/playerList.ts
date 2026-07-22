import type {
	CreatePlayerListInput,
	PlayerListSummary,
	UpdatePlayerListInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';
import { usePlayerListMembersRuntime } from '~/modules/event-data/playerListMembers';

export const usePlayerListStore = defineStore('playerList', () => {
	const repo = usePlayerListRepository();

	let memberRuntime: ReturnType<typeof usePlayerListMembersRuntime>;
	const lifecycle = useEventDataLifecycle<PlayerListSummary, CreatePlayerListInput, UpdatePlayerListInput>({
		repository: {
			...repo,
			create: async (eventId, input) => {
				const created = await repo.create(eventId, input);
				return { ...created, memberCount: 0 };
			},
			remove: async (eventId, listId) => {
				const result = await repo.remove(eventId, listId);
				if (!result.success)
					throw new Error('Failed to delete player list');
				return result;
			},
		},
		entityLabel: 'Player list',
		onReset: () => {
			memberRuntime?.reset();
		},
	});
	const lists = lifecycle.items;
	const loading = lifecycle.loading;
	const error = lifecycle.error;
	const isLoaded = lifecycle.isLoaded;
	memberRuntime = usePlayerListMembersRuntime({ lists, error, repository: repo });
	const membersByListId = memberRuntime.membersByListId;

	// ── Actions ──

	const addMembers = memberRuntime.addMembers;
	const removeMember = memberRuntime.removeMember;
	const batchRemoveMembers = memberRuntime.batchRemoveMembers;
	const reorderMembers = memberRuntime.reorderMembers;
	const loadListMembers = memberRuntime.loadListMembers;
	const getCachedMemberIds = memberRuntime.getCachedMemberIds;

	async function loadByEventId(eventId: number) {
		return lifecycle.loadFrom(eventId, async () => {
			const listsData = await repo.list(eventId);

			// Preload member IDs for all lists in parallel (lightweight, just number arrays).
			if (listsData.length > 0) {
				await Promise.all(
					listsData.map(list => loadListMembers(eventId, list.id)),
				);
			}

			return listsData;
		});
	}

	async function createList(eventId: number, input: CreatePlayerListInput) {
		return lifecycle.create(eventId, input);
	}

	async function updateList(eventId: number, listId: number, input: UpdatePlayerListInput) {
		return lifecycle.update(eventId, listId, input);
	}

	async function removeList(eventId: number, listId: number) {
		const cachedIds = memberRuntime.clearListMembers(listId);
		try {
			const removed = await lifecycle.remove(eventId, listId);
			if (removed === null)
				memberRuntime.restoreListMembers(listId, cachedIds);
			return removed;
		}
		catch (err) {
			memberRuntime.restoreListMembers(listId, cachedIds);
			throw err;
		}
	}

	// ── Realtime Handlers ──

	function applyRemoteCreated(data: MessageData<'playerList:created'>) {
		lifecycle.applyRemoteCreated({ ...data.playerList, memberCount: data.playerList.memberCount ?? 0 });
	}

	function applyRemoteUpdated(data: MessageData<'playerList:updated'>) {
		const index = lists.value.findIndex(l => l.id === data.playerList.id);
		if (index !== -1) {
			lists.value[index] = { ...lists.value[index]!, ...data.playerList };
		}
	}

	function applyRemoteDeleted(data: MessageData<'playerList:deleted'>) {
		lifecycle.applyRemoteDeleted(data.listId);
		memberRuntime.clearListMembers(data.listId);
	}

	function applyRemoteMembersChanged(data: MessageData<'playerList:membersChanged'>) {
		memberRuntime.applyRemoteMembersChanged(data.listId, data.memberCount);
	}

	function $reset() {
		lifecycle.reset();
	}

	return {
		// State
		lists,
		loading,
		error,
		isLoaded,
		membersByListId,

		// Actions
		loadByEventId,
		createList,
		updateList,
		removeList,
		addMembers,
		removeMember,
		batchRemoveMembers,
		reorderMembers,
		loadListMembers,
		getCachedMemberIds,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		applyRemoteMembersChanged,
		$reset,
	};
});
