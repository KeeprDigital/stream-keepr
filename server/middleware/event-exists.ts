import { eventService } from '~~/server/services/event';

/**
 * Server middleware that validates event existence for all `/api/events/:id/**` routes.
 * Parses and validates the event ID, checks the event exists, and stashes
 * `event.context.eventId` for downstream route handlers.
 */
const EVENT_PATH_RE = /^\/api\/events\/(\d+)(?:\/|$)/;

export default defineEventHandler(async (event) => {
	const path = getRequestURL(event).pathname;

	const match = path.match(EVENT_PATH_RE);
	if (!match)
		return;

	const id = Number(match[1]);
	if (!Number.isInteger(id) || id <= 0) {
		throw createError({ statusCode: 400, message: 'Invalid event ID' });
	}

	const exists = await eventService().exists(id);
	if (!exists) {
		throw createError({ statusCode: 404, message: 'Event not found' });
	}

	event.context.eventId = id;
});
