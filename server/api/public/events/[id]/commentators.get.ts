import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

/**
 * The names of the Event's two commentator Talents, for a vMix JSON Data Source
 * (ADR-0055).
 *
 * Answering only the two names, so nothing else about the Event is published.
 * vMix reads a JSON array as rows, so the one object is wrapped in one. An empty
 * slot is an empty string rather than `null`, which vMix would show as the text
 * "null".
 */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const found = await eventService().findById(id);
	if (!found) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	const nameOf = (talentId: number | null) =>
		found.talents.find(talent => talent.id === talentId)?.name ?? '';

	setResponseHeader(event, 'access-control-allow-origin', '*');
	setResponseHeader(event, 'cache-control', 'no-store');
	return [
		{
			commentator1: nameOf(found.commentator1TalentId),
			commentator2: nameOf(found.commentator2TalentId),
		},
	];
});
