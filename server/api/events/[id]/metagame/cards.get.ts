import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameCardsQuerySchema, metagameParamsSchema } from '~~/server/schemas/api/metagame';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, metagameParamsSchema.parse);
	const query = await getValidatedQuery(event, metagameCardsQuerySchema.parse);

	return metagameReadModel().getCardBreakdown(eventId, query);
});
