import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { featureMatchService } from '~~/server/services/featureMatch';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const slots = await featureMatchService().findByEventId(id);
	return {
		featureMatchSlots: slots.map(mapFeatureMatchToResponse),
		total: slots.length,
	};
});
