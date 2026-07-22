import type { PlayerListSummary } from '~/types';

interface PlayerListMembersRepository {
	addMembers: (eventId: number, listId: number, playerIds: number[]) => Promise<{ added: number; memberCount: number }>;
	removeMember: (eventId: number, listId: number, playerId: number) => Promise<{ success: boolean; memberCount: number }>;
	batchRemoveMembers: (eventId: number, listId: number, playerIds: number[]) => Promise<{ removed: number; memberCount: number }>;
	reorderMembers: (eventId: number, listId: number, playerIds: number[]) => Promise<{ reordered: number; memberCount: number }>;
	getMemberIds: (eventId: number, listId: number) => Promise<number[]>;
}

interface PlayerListMembersState {
	lists: Ref<PlayerListSummary[]>;
	error: Ref<string | null>;
	repository: PlayerListMembersRepository;
}

/**
 * Player List member Module.
 *
 * Owns member ID cache, optimistic member-count updates, member mutation
 * rollback, and realtime member cache invalidation for Event Data Player Lists.
 */
export function usePlayerListMembersRuntime(state: PlayerListMembersState) {
	const { executeAction } = useAsyncAction();
	const membersByListId = ref<Map<number, number[]>>(new Map());

	function setMemberCount(listId: number, memberCount: number) {
		const index = state.lists.value.findIndex(l => l.id === listId);
		if (index !== -1) {
			state.lists.value[index] = { ...state.lists.value[index]!, memberCount };
		}
	}

	function clearListMembers(listId: number): number[] | undefined {
		const cachedIds = membersByListId.value.get(listId);
		membersByListId.value.delete(listId);
		return cachedIds;
	}

	function restoreListMembers(listId: number, cachedIds: number[] | undefined) {
		if (cachedIds) {
			membersByListId.value.set(listId, cachedIds);
		}
	}

	async function addMembers(eventId: number, listId: number, playerIds: number[]) {
		const index = state.lists.value.findIndex(l => l.id === listId);
		const originalCount = index !== -1 ? state.lists.value[index]!.memberCount : 0;
		const cachedIds = membersByListId.value.get(listId);

		// When cache is available, deduplicate and skip if nothing to add.
		const idsToAdd = cachedIds
			? playerIds.filter(id => !cachedIds.includes(id))
			: playerIds;

		if (idsToAdd.length === 0)
			return;

		// Optimistic: increment member count by actual new IDs.
		if (index !== -1) {
			state.lists.value[index] = { ...state.lists.value[index]!, memberCount: originalCount + idsToAdd.length };
		}

		// Optimistic: update cached member IDs.
		if (cachedIds) {
			membersByListId.value.set(listId, [...cachedIds, ...idsToAdd]);
		}

		return executeAction(
			async () => {
				const result = await state.repository.addMembers(eventId, listId, idsToAdd);
				setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				onError: () => {
					if (index !== -1) {
						state.lists.value[index] = { ...state.lists.value[index]!, memberCount: originalCount };
					}
					if (cachedIds) {
						membersByListId.value.set(listId, cachedIds);
					}
				},
			},
		);
	}

	async function removeMember(eventId: number, listId: number, playerId: number) {
		// Optimistic: decrement member count.
		const index = state.lists.value.findIndex(l => l.id === listId);
		const originalCount = index !== -1 ? state.lists.value[index]!.memberCount : 0;
		if (index !== -1) {
			state.lists.value[index] = { ...state.lists.value[index]!, memberCount: Math.max(0, originalCount - 1) };
		}

		// Optimistic: update cached member IDs.
		const cachedIds = membersByListId.value.get(listId);
		if (cachedIds) {
			membersByListId.value.set(listId, cachedIds.filter(id => id !== playerId));
		}

		return executeAction(
			async () => {
				const result = await state.repository.removeMember(eventId, listId, playerId);
				if (!result.success) {
					throw new Error('Failed to remove player from list');
				}
				setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				onError: () => {
					if (index !== -1) {
						state.lists.value[index] = { ...state.lists.value[index]!, memberCount: originalCount };
					}
					if (cachedIds) {
						membersByListId.value.set(listId, cachedIds);
					}
				},
			},
		);
	}

	async function batchRemoveMembers(eventId: number, listId: number, playerIds: number[]) {
		// Optimistic: decrement member count.
		const index = state.lists.value.findIndex(l => l.id === listId);
		const originalCount = index !== -1 ? state.lists.value[index]!.memberCount : 0;
		if (index !== -1) {
			state.lists.value[index] = { ...state.lists.value[index]!, memberCount: Math.max(0, originalCount - playerIds.length) };
		}

		// Optimistic: update cached member IDs.
		const cachedIds = membersByListId.value.get(listId);
		if (cachedIds) {
			const removeSet = new Set(playerIds);
			membersByListId.value.set(listId, cachedIds.filter(id => !removeSet.has(id)));
		}

		return executeAction(
			async () => {
				const result = await state.repository.batchRemoveMembers(eventId, listId, playerIds);
				setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				onError: () => {
					if (index !== -1) {
						state.lists.value[index] = { ...state.lists.value[index]!, memberCount: originalCount };
					}
					if (cachedIds) {
						membersByListId.value.set(listId, cachedIds);
					}
				},
			},
		);
	}

	async function reorderMembers(eventId: number, listId: number, playerIds: number[]) {
		// Optimistic: update cached member IDs with new order.
		const cachedIds = membersByListId.value.get(listId);
		if (cachedIds) {
			membersByListId.value.set(listId, [...playerIds]);
		}

		return executeAction(
			async () => {
				const result = await state.repository.reorderMembers(eventId, listId, playerIds);
				setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				onError: () => {
					if (cachedIds) {
						membersByListId.value.set(listId, cachedIds);
					}
				},
			},
		);
	}

	async function loadListMembers(eventId: number, listId: number) {
		return executeAction(
			async () => {
				const memberIds = await state.repository.getMemberIds(eventId, listId);
				membersByListId.value.set(listId, memberIds);
				return memberIds;
			},
			{ errorRef: state.error },
		);
	}

	function getCachedMemberIds(listId: number): number[] | undefined {
		return membersByListId.value.get(listId);
	}

	function applyRemoteMembersChanged(listId: number, memberCount: number) {
		setMemberCount(listId, memberCount);
		membersByListId.value.delete(listId);
	}

	function reset() {
		membersByListId.value.clear();
	}

	return {
		membersByListId,
		setMemberCount,
		clearListMembers,
		restoreListMembers,
		addMembers,
		removeMember,
		batchRemoveMembers,
		reorderMembers,
		loadListMembers,
		getCachedMemberIds,
		applyRemoteMembersChanged,
		reset,
	};
}
