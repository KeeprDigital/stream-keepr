import type { H3Event } from 'h3';
import { eventParamsSchema } from '~~/server/schemas/api/event';

/**
 * Reuse the event ID resolved by middleware when available, while preserving
 * route-level validation for paths that bypass the numeric event middleware.
 */
export async function getEventId(event: H3Event): Promise<number> {
	const eventId = event.context.eventId;
	if (typeof eventId === 'number' && Number.isInteger(eventId) && eventId > 0) {
		return eventId;
	}

	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	return id;
}
