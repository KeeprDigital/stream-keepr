import type { CreatePlayerListInput, PlayerListResponse, UpdatePlayerListInput } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { playerListService } from '~~/server/services/playerList';

interface CreatePlayerListParams {
	eventId: number;
	input: CreatePlayerListInput;
	originConnectionId?: string;
}

interface UpdatePlayerListParams {
	eventId: number;
	listId: number;
	input: UpdatePlayerListInput;
	originConnectionId?: string;
}

interface DeletePlayerListParams {
	eventId: number;
	listId: number;
	originConnectionId?: string;
}

interface ChangeMembersParams {
	eventId: number;
	listId: number;
	playerIds: number[];
	originConnectionId?: string;
}

interface RemoveMemberParams {
	eventId: number;
	listId: number;
	playerId: number;
	originConnectionId?: string;
}

export function playerListWriteModule() {
	const publication = eventDataPublicationModule();
	const lists = playerListService();

	async function createPlayerList({
		eventId,
		input,
		originConnectionId,
	}: CreatePlayerListParams): Promise<PlayerListResponse> {
		const newList = await lists.create(eventId, input);

		return await publication.playerListCreated({
			eventId,
			entity: newList,
			originConnectionId,
		});
	}

	async function updatePlayerList({
		eventId,
		listId,
		input,
		originConnectionId,
	}: UpdatePlayerListParams): Promise<PlayerListResponse> {
		const updatedList = await lists.update(listId, eventId, input);

		if (!updatedList) {
			throw createError({
				statusCode: 404,
				message: 'Player list not found',
			});
		}

		return await publication.playerListUpdated({
			eventId,
			entity: updatedList,
			originConnectionId,
		});
	}

	async function deletePlayerList({
		eventId,
		listId,
		originConnectionId,
	}: DeletePlayerListParams): Promise<{ success: true }> {
		const result = await lists.remove(listId, eventId);

		if (!result) {
			throw createError({
				statusCode: 404,
				message: 'Player list not found',
			});
		}

		await publication.playerListDeleted({
			eventId,
			id: listId,
			originConnectionId,
		});

		return { success: true };
	}

	async function addPlayerListMembers({
		eventId,
		listId,
		playerIds,
		originConnectionId,
	}: ChangeMembersParams) {
		const result = await lists.addMembers(listId, eventId, playerIds);
		const memberCount = await lists.getMemberCount(listId, eventId);

		await publication.playerListMembersChanged({
			eventId,
			listId,
			playerIds,
			action: 'added',
			memberCount,
			originConnectionId,
		});

		return { ...result, memberCount };
	}

	async function removePlayerListMember({
		eventId,
		listId,
		playerId,
		originConnectionId,
	}: RemoveMemberParams) {
		const result = await lists.removeMember(listId, eventId, playerId);

		if (!result) {
			throw createError({
				statusCode: 404,
				message: 'Player list member not found',
			});
		}

		const memberCount = await lists.getMemberCount(listId, eventId);
		await publication.playerListMembersChanged({
			eventId,
			listId,
			playerIds: [playerId],
			action: 'removed',
			memberCount,
			originConnectionId,
		});

		return { success: true as const, memberCount };
	}

	async function batchRemovePlayerListMembers({
		eventId,
		listId,
		playerIds,
		originConnectionId,
	}: ChangeMembersParams) {
		const removed = await lists.batchRemoveMembers(listId, eventId, playerIds);
		const memberCount = await lists.getMemberCount(listId, eventId);

		await publication.playerListMembersChanged({
			eventId,
			listId,
			playerIds,
			action: 'removed',
			memberCount,
			originConnectionId,
		});

		return { removed, memberCount };
	}

	async function reorderPlayerListMembers({
		eventId,
		listId,
		playerIds,
		originConnectionId,
	}: ChangeMembersParams) {
		const result = await lists.reorderMembers(listId, eventId, playerIds);
		const memberCount = await lists.getMemberCount(listId, eventId);

		await publication.playerListMembersChanged({
			eventId,
			listId,
			playerIds,
			action: 'reordered',
			memberCount,
			originConnectionId,
		});

		return { ...result, memberCount };
	}

	return {
		createPlayerList,
		updatePlayerList,
		deletePlayerList,
		addPlayerListMembers,
		removePlayerListMember,
		batchRemovePlayerListMembers,
		reorderPlayerListMembers,
	};
}
