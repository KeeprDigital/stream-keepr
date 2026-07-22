import { featureMatchPromotionModule } from '~~/server/modules/feature-match-promotion';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { promoteMatchSchema } from '~~/server/schemas/api/match';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const { matchId } = await readValidatedBody(event, promoteMatchSchema.parse);
	const originConnectionId = getOriginConnectionId(event);
	return await featureMatchPromotionModule().promoteMatchToSlot({
		eventId: id,
		slotId,
		matchId,
		originConnectionId,
	});
});
