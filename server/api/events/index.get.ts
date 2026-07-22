import { mapEventListToResponse } from '~~/server/mappers/event';
import { eventService } from '~~/server/services/event';

export default defineEventHandler(async () => {
	const allEvents = await eventService().findAll();

	return {
		events: allEvents.map(mapEventListToResponse),
		total: allEvents.length,
	};
});
