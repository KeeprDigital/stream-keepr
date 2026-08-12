import { mapEventToResponse } from '~~/server/mappers/event';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	// `event-exists` middleware answered a separate, earlier query, so this one
	// is not a redundant re-read: it is the only lookup whose answer can still
	// be true when the response is written. A deletion landing between the two
	// used to reach the mapper as `undefined` and answer 500 (#309).
	const eventData = await eventService().findById(id);
	if (!eventData) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	return mapEventToResponse(eventData);
});
