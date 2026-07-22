import { mapRoundToResponse } from '~~/server/mappers/round';
import { roundParamsSchema } from '~~/server/schemas/api/round';
import { roundService } from '~~/server/services/round';

export default defineEventHandler(async (event) => {
	const { id, roundId } = await getValidatedRouterParams(event, roundParamsSchema.parse);

	const round = await roundService().findById(roundId, id);
	if (!round) {
		throw createError({ statusCode: 404, message: 'Round not found' });
	}

	return mapRoundToResponse(round);
});
