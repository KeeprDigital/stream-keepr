import type {
	BroadcastDeckListResponse,
	BroadcastDeckListSummaryResponse,
	CreateBroadcastDeckListInput,
	UpdateBroadcastDeckListInput,
} from '~~/shared/types/broadcastDeckList';
import { isEventDataNotFoundError, useEventDataFetch } from '~/modules/event-data/client';

export function useBroadcastDeckListRepository() {
	const eventData = useEventDataFetch();
	const path = (eventId: number, listId?: number) => ({
		eventId,
		resourcePath: 'broadcast-deck-lists',
		...(listId ? { resourceId: listId } : {}),
	});

	const list = async (eventId: number) => {
		const response = await eventData.command<{ broadcastDeckLists: BroadcastDeckListSummaryResponse[] }>(
			path(eventId),
			{ method: 'GET' },
		);
		return response.broadcastDeckLists;
	};

	const getById = async (eventId: number, listId: number) => {
		try {
			return await eventData.command<BroadcastDeckListResponse>(path(eventId, listId), { method: 'GET' });
		}
		catch (error) {
			if (isEventDataNotFoundError(error))
				return null;
			throw error;
		}
	};

	const create = async (eventId: number, input: CreateBroadcastDeckListInput) => {
		return await eventData.command<BroadcastDeckListResponse, CreateBroadcastDeckListInput>(
			path(eventId),
			{ method: 'POST', body: input },
		);
	};

	const update = async (eventId: number, listId: number, input: UpdateBroadcastDeckListInput) => {
		return await eventData.command<BroadcastDeckListResponse, UpdateBroadcastDeckListInput>(
			path(eventId, listId),
			{ method: 'PATCH', body: input },
		);
	};

	const remove = async (eventId: number, listId: number, expectedRevision: number) => {
		return await eventData.command<{ success: true }, { expectedRevision: number }>(
			path(eventId, listId),
			{ method: 'DELETE', body: { expectedRevision } },
		);
	};

	return { list, getById, create, update, remove };
}
