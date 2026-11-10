import { requireMeleeSyncOffered } from '~~/server/modules/melee-sync/eventData';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { playerDeckUnresolvedCardService } from '~~/server/services/playerDeckUnresolvedCard';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	await requireMeleeSyncOffered(eventId);

	return playerDeckUnresolvedCardService().listByEventId(eventId);
});
