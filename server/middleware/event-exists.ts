import { EVENT_ID_PATTERN } from '~~/server/schemas/api/eventId';
import { eventService } from '~~/server/services/event';

/**
 * Server middleware that validates event existence for all `/api/events/:id/**` routes.
 * Parses and validates the event ID, checks the event exists, and stashes
 * `event.context.eventId` for downstream route handlers.
 *
 * It matches whatever stands in the id segment and refuses any spelling outside
 * the grammar the handlers' param schema reads (`eventIdParamSchema`), so no
 * handler coerces an id this never checked.
 */
const EVENT_PATH_RE = /^\/api\/events\/([^/]+)(?:\/|$)/;

export default defineEventHandler(async (event) => {
	const path = getRequestURL(event).pathname;

	const match = path.match(EVENT_PATH_RE);
	if (!match)
		return;

	const id = Number(match[1]);
	if (!EVENT_ID_PATTERN.test(match[1]!) || !Number.isSafeInteger(id)) {
		throw createError({ statusCode: 400, message: 'Invalid event ID' });
	}

	const exists = await eventService().exists(id);
	if (!exists) {
		throw createError({ statusCode: 404, message: 'Event not found' });
	}

	event.context.eventId = id;
});
