import { z } from 'zod';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { screenSlugSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { getEventId } from '~~/server/utils/eventId';

const screenSlugRouteSchema = z.object({
	slug: screenSlugSchema,
});

export default defineEventHandler(async (event) => {
	const eventId = await getEventId(event);
	const { slug } = await getValidatedRouterParams(event, screenSlugRouteSchema.parse);

	const screen = await screenService().findBySlug(eventId, slug);

	if (!screen) {
		throw createError({
			statusCode: 404,
			message: 'Screen not found',
		});
	}

	return mapScreenToResponse(screen);
});
