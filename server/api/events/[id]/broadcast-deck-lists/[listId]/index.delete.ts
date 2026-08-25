import { broadcastDeckListWriteModule } from '~~/server/modules/broadcast-deck-list-write';
import { broadcastDeckListParamsSchema, deleteBroadcastDeckListSchema } from '~~/server/schemas/api/broadcastDeckList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, broadcastDeckListParamsSchema.parse);
	const { expectedRevision } = await readValidatedBody(event, deleteBroadcastDeckListSchema.parse);
	return await broadcastDeckListWriteModule().deleteBroadcastDeckList({
		eventId: id,
		listId,
		expectedRevision,
		originConnectionId: getOriginConnectionId(event),
	});
});
