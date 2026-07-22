import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { featureMatchService } from '~~/server/services/featureMatch';

export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const slot = await featureMatchService().findById(slotId, id);
	if (!slot) {
		throw createError({ statusCode: 404, message: 'Feature match slot not found' });
	}
	return mapFeatureMatchToResponse(slot);
});
