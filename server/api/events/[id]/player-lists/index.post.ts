import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createPlayerListSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createPlayerListSchema.parse);

	const response = await playerListWriteModule().createPlayerList({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
