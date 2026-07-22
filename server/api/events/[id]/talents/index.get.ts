import { mapTalentToResponse } from '~~/server/mappers/talent';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { talentService } from '~~/server/services/talent';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const talents = await talentService().findByEventId(id);

	return {
		talents: talents.map(mapTalentToResponse),
		total: talents.length,
	};
});
