import { mapMatchToResponse } from '~~/server/mappers/match';
import { matchParamsSchema } from '~~/server/schemas/api/match';
import { matchService } from '~~/server/services/match';

export default defineEventHandler(async (event) => {
	const { id, matchId } = await getValidatedRouterParams(event, matchParamsSchema.parse);

	const match = await matchService().findById(matchId, id);
	if (!match) {
		throw createError({ statusCode: 404, message: 'Match not found' });
	}

	return mapMatchToResponse(match);
});
