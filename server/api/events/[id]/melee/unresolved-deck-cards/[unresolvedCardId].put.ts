import { z } from 'zod';
import { deckListResolutionModule } from '~~/server/modules/deck-list-resolution';

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
	unresolvedCardId: z.coerce.number().int().positive(),
});

const bodySchema = z.object({
	scryfallId: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
	const { id: eventId, unresolvedCardId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const body = await readValidatedBody(event, bodySchema.parse);

	return await deckListResolutionModule().resolveUnresolvedDeckCard({
		eventId,
		unresolvedCardId,
		scryfallId: body.scryfallId,
	});
});
