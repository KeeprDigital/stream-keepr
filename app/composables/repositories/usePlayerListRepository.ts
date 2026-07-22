import type {
	CreatePlayerListInput,
	Player,
	PlayerList,
	PlayerListSummary,
	UpdatePlayerListInput,
} from '~/types';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';

export function usePlayerListRepository() {
	const base = useEventDataResource<PlayerListSummary, CreatePlayerListInput, UpdatePlayerListInput>({
		resourcePath: 'player-lists',
		eventScoped: true,
		includeHeaders: true,
		responseKey: 'playerLists',
	});
	const eventData = useEventDataFetch();

	const getById = async (eventId: number, listId: number) => {
		return await $fetch<PlayerList & { members: Player[] }>(
			`/api/events/${eventId}/player-lists/${listId}`,
		);
	};

	// ── Member Management (custom, not via base) ──

	const addMembers = async (eventId: number, listId: number, playerIds: number[]) => {
		return await eventData.command<{ added: number; memberCount: number }, { playerIds: number[] }>(
			{ eventId, resourcePath: 'player-lists', resourceId: listId, suffix: 'members' },
			{ method: 'POST', body: { playerIds } },
		);
	};

	const removeMember = async (eventId: number, listId: number, playerId: number) => {
		return await eventData.command<{ success: boolean; memberCount: number }>(
			{ eventId, resourcePath: 'player-lists', resourceId: listId, suffix: `members/${playerId}` },
			{ method: 'DELETE' },
		);
	};

	const batchRemoveMembers = async (eventId: number, listId: number, playerIds: number[]) => {
		return await eventData.command<{ removed: number; memberCount: number }, { playerIds: number[] }>(
			{ eventId, resourcePath: 'player-lists', resourceId: listId, suffix: 'members/batch-remove' },
			{ method: 'POST', body: { playerIds } },
		);
	};

	const reorderMembers = async (eventId: number, listId: number, playerIds: number[]) => {
		return await eventData.command<{ reordered: number; memberCount: number }, { playerIds: number[] }>(
			{ eventId, resourcePath: 'player-lists', resourceId: listId, suffix: 'members/reorder' },
			{ method: 'PUT', body: { playerIds } },
		);
	};

	const getMemberIds = async (eventId: number, listId: number) => {
		const response = await $fetch<{ memberIds: number[] }>(
			`/api/events/${eventId}/player-lists/${listId}/member-ids`,
		);
		return response.memberIds;
	};

	return { list: base.list, getById, create: base.create, update: base.update, remove: base.remove, addMembers, removeMember, batchRemoveMembers, reorderMembers, getMemberIds };
}
