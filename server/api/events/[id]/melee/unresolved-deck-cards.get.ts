import { requireMeleeSyncEventData } from '~~/server/modules/melee-sync/eventData';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { playerDeckUnresolvedCardService } from '~~/server/services/playerDeckUnresolvedCard';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	await requireMeleeSyncEventData(eventId);

	return playerDeckUnresolvedCardService().listByEventId(eventId);
});
