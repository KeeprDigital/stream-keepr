import { eventWriteModule } from '~~/server/modules/event-write';
import { eventParamsSchema, updateEventSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, updateEventSchema.parse);

	return await eventWriteModule().updateEvent({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
