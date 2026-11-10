import { z } from 'zod';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { getOriginConnectionId } from '~~/server/utils/ably';

const reviewParamsSchema = z.object({
	id: eventIdParamSchema,
	playerId: z.coerce.number().int().positive(),
	deckId: z.coerce.number().int().positive(),
});

const reviewBodySchema = z.object({
	archetypeId: z.number().int().positive(),
});

export default defineEventHandler(async (event) => {
	const { id: eventId, playerId, deckId } = await getValidatedRouterParams(event, reviewParamsSchema.parse);
	const { archetypeId } = await readValidatedBody(event, reviewBodySchema.parse);

	return await playerUpdateModule().reviewPlayerDeck({
		eventId,
		playerId,
		deckId,
		archetypeId,
		originConnectionId: getOriginConnectionId(event),
	});
});
