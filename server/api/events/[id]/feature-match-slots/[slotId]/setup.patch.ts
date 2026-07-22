import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { featureMatchSlotParamsSchema, updateFeatureMatchSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const body = await readValidatedBody(event, updateFeatureMatchSchema.parse);

	return await featureMatchSlotWriteModule().updateSetup({
		eventId: id,
		slotId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
