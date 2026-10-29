import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

/**
 * The Event's holding text, for a vMix JSON Data Source (ADR-0055).
 *
 * Answering only the holding text. Wrapped in an array because vMix reads one
 * as rows, and an unset holding text is an empty string rather than `null`,
 * which vMix would show as the text "null".
 */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const found = await eventService().findById(id);
	if (!found) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	setResponseHeader(event, 'access-control-allow-origin', '*');
	setResponseHeader(event, 'cache-control', 'no-store');
	return [
		{ holdingText: found.holdingText ?? '' },
	];
});
