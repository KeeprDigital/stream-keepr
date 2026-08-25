import { broadcastDeckListWriteModule } from '~~/server/modules/broadcast-deck-list-write';
import { broadcastDeckListParamsSchema, updateBroadcastDeckListSchema } from '~~/server/schemas/api/broadcastDeckList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, broadcastDeckListParamsSchema.parse);
	const input = await readValidatedBody(event, updateBroadcastDeckListSchema.parse);
	return await broadcastDeckListWriteModule().updateBroadcastDeckList({
		eventId: id,
		listId,
		input,
		originConnectionId: getOriginConnectionId(event),
	});
});
