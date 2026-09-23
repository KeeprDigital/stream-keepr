import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameArchetypeDetailQuerySchema, metagameArchetypeParamsSchema } from '~~/server/schemas/api/metagame';

export default defineEventHandler(async (event) => {
	const { id: eventId, archetypeId } = await getValidatedRouterParams(event, metagameArchetypeParamsSchema.parse);
	const query = await getValidatedQuery(event, metagameArchetypeDetailQuerySchema.parse);

	const detail = await metagameReadModel().getArchetypeDetail(eventId, {
		...query,
		archetypeId,
	});

	if (!detail) {
		throw createError({ statusCode: 404, statusMessage: 'Archetype not found' });
	}

	return detail;
});
