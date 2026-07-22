import { mapPlayerDeckSummary } from '~~/server/mappers/playerDeck';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { archetypeService } from '~~/server/services/archetype';
import { eventService } from '~~/server/services/event';
import { playerDeckService } from '~~/server/services/playerDeck';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	if (!await eventService().findById(eventId)) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	const decks = await playerDeckService().listByEvent(eventId);
	const reviewedArchetypes = await archetypeService().findManyByIds(
		eventId,
		decks.flatMap(deck => deck.reviewedAt != null && deck.archetypeId != null ? [deck.archetypeId] : []),
	);
	const archetypesById = new Map(reviewedArchetypes.map(archetype => [archetype.id, archetype]));

	return {
		decks: decks.map(deck => mapPlayerDeckSummary(
			deck,
			deck.archetypeId == null ? null : archetypesById.get(deck.archetypeId),
		)),
	};
});
