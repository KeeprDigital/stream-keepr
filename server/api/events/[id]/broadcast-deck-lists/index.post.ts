import { broadcastDeckListWriteModule } from '~~/server/modules/broadcast-deck-list-write';
import { createBroadcastDeckListSchema } from '~~/server/schemas/api/broadcastDeckList';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const input = await readValidatedBody(event, createBroadcastDeckListSchema.parse);
	const response = await broadcastDeckListWriteModule().createBroadcastDeckList({
		eventId: id,
		input,
		originConnectionId: getOriginConnectionId(event),
	});
	setResponseStatus(event, 201);
	return response;
});
