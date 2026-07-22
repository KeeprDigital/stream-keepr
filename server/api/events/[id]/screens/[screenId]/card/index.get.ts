import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { cardService } from '~~/server/services/card';
import { screenService } from '~~/server/services/screen';

export default defineEventHandler(async (event) => {
	const { id, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const screen = await screenService().findById(screenId, id);
	if (!screen) {
		throw createError({
			statusCode: 404,
			message: 'Screen not found',
		});
	}

	const card = await cardService().getScreenCard(id, screenId);

	return card;
});
