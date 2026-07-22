import { z } from 'zod';
import { playerParamsSchema } from '~~/server/schemas/api/player';
import { eventService } from '~~/server/services/event';
import { playerService } from '~~/server/services/player';
import { playerDeckCardService } from '~~/server/services/playerDeckCard';

const deckQuerySchema = z.object({
	deckId: z.coerce.number().int().positive().optional(),
	phaseId: z.coerce.number().int().positive().optional(),
	roundId: z.coerce.number().int().positive().optional(),
});

export default defineEventHandler(async (event) => {
	const { id: eventId, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);
	const selection = await getValidatedQuery(event, deckQuerySchema.parse);

	const player = await playerService().findById(playerId, eventId);
	if (!player) {
		throw createError({ statusCode: 404, statusMessage: 'Player not found' });
	}

	const eventData = await eventService().findById(eventId);
	if (!eventData) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	return playerDeckCardService().getPlayerDecks(
		eventId,
		playerId,
		eventData.pointsSystem ?? null,
		selection,
	);
});
