import { z } from 'zod';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { getOriginConnectionId } from '~~/server/utils/ably';

const reviewParamsSchema = z.object({
	id: eventIdParamSchema,
	playerId: z.coerce.number().int().positive(),
	deckId: z.coerce.number().int().positive(),
});

/** Clears a Deck List's review: it returns to unreviewed, and its Archetype stays. */
export default defineEventHandler(async (event) => {
	const { id: eventId, playerId, deckId } = await getValidatedRouterParams(event, reviewParamsSchema.parse);

	return await playerUpdateModule().clearPlayerDeckReview({
		eventId,
		playerId,
		deckId,
		originConnectionId: getOriginConnectionId(event),
	});
});
