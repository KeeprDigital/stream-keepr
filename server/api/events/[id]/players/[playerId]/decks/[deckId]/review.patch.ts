import { z } from 'zod';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { getOriginConnectionId } from '~~/server/utils/ably';

const reviewParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
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
