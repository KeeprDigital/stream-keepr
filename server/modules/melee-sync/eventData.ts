import { eventService } from '~~/server/services/event';

/**
 * Melee Sync Event data loader.
 *
 * Keeps route modules from each knowing how to load and validate the Event
 * before crossing the Melee Sync workflow seam.
 */
export async function requireMeleeSyncEventData(eventId: number) {
	const eventData = await eventService().findById(eventId);
	if (!eventData) {
		throw createError({
			statusCode: 404,
			message: 'Event not found',
		});
	}
	return eventData;
}
