import { screenWriteModule } from '~~/server/modules/screen-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createScreenSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const input = await readValidatedBody(event, createScreenSchema.parse);

	const response = await screenWriteModule().createScreen({
		eventId,
		input,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
