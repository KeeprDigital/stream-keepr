import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { reorderFeatureMatchSlotSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, reorderFeatureMatchSlotSchema.parse);

	return await featureMatchSlotWriteModule().reorder({
		eventId: id,
		slotId: body.slotId,
		direction: body.direction,
		originConnectionId: getOriginConnectionId(event),
	});
});
