import { mapEventToResponse } from '~~/server/mappers/event';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const eventData = (await eventService().findById(id))!;

	return mapEventToResponse(eventData);
});
