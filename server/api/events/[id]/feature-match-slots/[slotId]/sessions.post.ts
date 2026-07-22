import { featureMatchSessionModule } from '~~/server/modules/feature-match-session';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const originConnectionId = getOriginConnectionId(event);

	const session = await featureMatchSessionModule().createSessionForSlot(slotId, id, originConnectionId);
	if (!session) {
		throw createError({ statusCode: 404, message: 'Feature match slot not found' });
	}

	return session;
});
