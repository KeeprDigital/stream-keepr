import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { featureMatchSlotParamsSchema, swapFeatureMatchSeatsSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const body = await readValidatedBody(event, swapFeatureMatchSeatsSchema.parse);

	return await featureMatchSlotWriteModule().swapSeats({
		eventId: id,
		slotId,
		seats: body.seats,
		originConnectionId: getOriginConnectionId(event),
	});
});
