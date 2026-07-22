import { roundWriteModule } from '~~/server/modules/round-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createRoundSchema } from '~~/server/schemas/api/round';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createRoundSchema.parse);

	const response = await roundWriteModule().create({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
