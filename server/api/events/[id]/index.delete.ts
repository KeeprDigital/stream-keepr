import { eventWriteModule } from '~~/server/modules/event-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	return await eventWriteModule().deleteEvent({
		eventId: id,
		originConnectionId: getOriginConnectionId(event),
	});
});
