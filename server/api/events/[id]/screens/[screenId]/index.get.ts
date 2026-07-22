import { mapScreenToResponse } from '~~/server/mappers/screen';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const screen = await screenService().findById(screenId, eventId);

	if (!screen) {
		throw createError({
			statusCode: 404,
			message: 'Screen not found',
		});
	}

	return mapScreenToResponse(screen);
});
