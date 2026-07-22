import { matchWriteModule } from '~~/server/modules/match-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createMatchSchema } from '~~/server/schemas/api/match';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createMatchSchema.parse);

	const response = await matchWriteModule().create({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
