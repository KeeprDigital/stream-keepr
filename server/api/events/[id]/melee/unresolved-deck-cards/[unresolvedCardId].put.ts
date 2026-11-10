import { z } from 'zod';
import { deckListResolutionModule } from '~~/server/modules/deck-list-resolution';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { getOriginConnectionId } from '~~/server/utils/ably';

const paramsSchema = z.object({
	id: eventIdParamSchema,
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
		requestEvent: event,
		originConnectionId: getOriginConnectionId(event),
	});
});
