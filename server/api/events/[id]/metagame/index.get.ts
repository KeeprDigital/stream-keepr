import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameParamsSchema, metagameQuerySchema } from '~~/server/schemas/api/metagame';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, metagameParamsSchema.parse);
	const query = await getValidatedQuery(event, metagameQuerySchema.parse);

	return metagameReadModel().getSummary(eventId, query);
});
