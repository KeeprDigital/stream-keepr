import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);

	return await featureMatchSlotWriteModule().remove({
		eventId: id,
		slotId,
		originConnectionId: getOriginConnectionId(event),
	});
});
