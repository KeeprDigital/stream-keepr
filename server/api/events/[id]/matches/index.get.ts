import { mapMatchToResponse } from '~~/server/mappers/match';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { matchQuerySchema } from '~~/server/schemas/api/match';
import { matchService } from '~~/server/services/match';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const query = await getValidatedQuery(event, matchQuerySchema.parse);

	const svc = matchService();
	const matchList = query?.roundId
		? await svc.findByRoundId(id, query.roundId)
		: await svc.findByEventId(id);

	return {
		matches: matchList.map(mapMatchToResponse),
		total: matchList.length,
	};
});
