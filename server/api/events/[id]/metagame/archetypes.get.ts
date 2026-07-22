import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameArchetypesQuerySchema, metagameParamsSchema } from '~~/server/schemas/api/metagame';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, metagameParamsSchema.parse);
	const query = await getValidatedQuery(event, metagameArchetypesQuerySchema.parse);

	return metagameReadModel().getArchetypeBreakdown(eventId, query);
});
