import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

/**
 * An Event's commentator Talent names and holding text, unauthenticated and
 * readable from any origin. A stopgap for outside tools (ADR-0055): names and
 * wording only, nothing an operator would not already put on air.
 */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const eventData = await eventService().findById(id);
	if (!eventData) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	const nameOf = (talentId: number | null) =>
		eventData.talents.find(talent => talent.id === talentId)?.name ?? null;

	setResponseHeader(event, 'access-control-allow-origin', '*');
	setResponseHeader(event, 'cache-control', 'no-store');

	return {
		eventId: eventData.id,
		eventName: eventData.name,
		holdingText: eventData.holdingText,
		talent: [
			{
				slot: 1,
				name: nameOf(eventData.commentator1TalentId),
			},
			{
				slot: 2,
				name: nameOf(eventData.commentator2TalentId),
			},
		].filter((entry): entry is { slot: number; name: string } => entry.name !== null),
	};
});
