import { eventParamsSchema } from '~~/server/schemas/api/event';
import { broadcastDeckListService } from '~~/server/services/broadcastDeckList';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const broadcastDeckLists = await broadcastDeckListService().findByEventId(id);
	return { broadcastDeckLists, total: broadcastDeckLists.length };
});
