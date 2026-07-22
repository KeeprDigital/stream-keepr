import { playerUpdateModule } from '~~/server/modules/player-update';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createPlayerSchema } from '~~/server/schemas/api/player';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createPlayerSchema.parse);

	const response = await playerUpdateModule().createPlayer({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
