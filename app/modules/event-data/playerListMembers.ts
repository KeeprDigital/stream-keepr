import type { PlayerListSummary } from '~/types';
import type { Flight } from '~/utils/guardedSequence';

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
	/** The Player Lists' current Event Lifetime; a write answered after it ends lands nowhere (#606). */
	currentLifetime: () => Flight;
}

/**
 * Player List member Module.
 *
 * Owns member ID cache, optimistic member-count updates, member mutation
 * rollback, and realtime member cache invalidation for Event Data Player Lists.
 */
export function usePlayerListMembersRuntime(state: PlayerListMembersState) {
	/**
	 * Every mutation here reports the sentence the server wrote about a refusal, where it
	 * wrote one. The Event Data lifecycle already did this for the Player Lists themselves
	 * (#262), so creating a list said why it was refused while adding a player to one said
	 * '[POST] "…": 409 Conflict' — the same pane, two different vocabularies. The rollbacks
	 * below are unaffected: the substitution happens inside the action, so `onError` still
	 * sees a failure and still puts the optimistic count back (#271).
	 */
	const { executeReporting } = useReportingAction();
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

		const flight = state.currentLifetime();
		return executeReporting(
			async () => {
				const result = await state.repository.addMembers(eventId, listId, idsToAdd);
				if (flight.current)
					setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				flight,
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

		const flight = state.currentLifetime();
		return executeReporting(
			async () => {
				const result = await state.repository.removeMember(eventId, listId, playerId);
				if (!result.success) {
					throw new Error('Failed to remove player from list');
				}
				if (flight.current)
					setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				flight,
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

		const flight = state.currentLifetime();
		return executeReporting(
			async () => {
				const result = await state.repository.batchRemoveMembers(eventId, listId, playerIds);
				if (flight.current)
					setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				flight,
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

		const flight = state.currentLifetime();
		return executeReporting(
			async () => {
				const result = await state.repository.reorderMembers(eventId, listId, playerIds);
				if (flight.current)
					setMemberCount(listId, result.memberCount);
				return result;
			},
			{
				errorRef: state.error,
				flight,
				onError: () => {
					if (cachedIds) {
						membersByListId.value.set(listId, cachedIds);
					}
				},
			},
		);
	}

	async function loadListMembers(eventId: number, listId: number) {
		const flight = state.currentLifetime();
		return executeReporting(
			async () => {
				const memberIds = await state.repository.getMemberIds(eventId, listId);
				if (flight.current)
					membersByListId.value.set(listId, memberIds);
				return memberIds;
			},
			{ errorRef: state.error, flight },
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
