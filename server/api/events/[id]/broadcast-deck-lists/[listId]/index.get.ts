import { broadcastDeckListParamsSchema } from '~~/server/schemas/api/broadcastDeckList';
import { broadcastDeckListService } from '~~/server/services/broadcastDeckList';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, broadcastDeckListParamsSchema.parse);
	const list = await broadcastDeckListService().findById(listId, id);
	if (!list)
		throw createError({ statusCode: 404, message: 'Broadcast Deck List not found' });
	return list;
});
