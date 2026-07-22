import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameCardParamsSchema, metagameQuerySchema } from '~~/server/schemas/api/metagame';

export default defineEventHandler(async (event) => {
	const { id: eventId, cardId } = await getValidatedRouterParams(event, metagameCardParamsSchema.parse);
	const query = await getValidatedQuery(event, metagameQuerySchema.parse);

	const detail = await metagameReadModel().getCardDetail(eventId, {
		...query,
		cardId,
	});

	if (!detail) {
		throw createError({ statusCode: 404, statusMessage: 'Card not found' });
	}

	return detail;
});
