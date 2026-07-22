import { mapScreenToResponse } from '~~/server/mappers/screen';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { screenService } from '~~/server/services/screen';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const screens = await screenService().findByEventId(id);

	return {
		screens: screens.map(mapScreenToResponse),
		total: screens.length,
	};
});
