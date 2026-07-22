import { mapRoundToResponse } from '~~/server/mappers/round';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { roundService } from '~~/server/services/round';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const rounds = await roundService().findByEventId(id);
	return {
		rounds: rounds.map(mapRoundToResponse),
		total: rounds.length,
	};
});
