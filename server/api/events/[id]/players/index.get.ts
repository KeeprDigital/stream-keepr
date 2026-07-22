import { mapPlayerToResponse } from '~~/server/mappers/player';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { playerQuerySchema } from '~~/server/schemas/api/player';
import { playerService } from '~~/server/services/player';
import { requirePlayerListInEvent } from '~~/server/utils/routeGuards';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const query = await getValidatedQuery(event, playerQuerySchema.parse);
	await requirePlayerListInEvent(id, query?.listId);

	const players = await playerService().findAll({ eventId: id, listId: query?.listId });

	return {
		players: players.map(mapPlayerToResponse),
		total: players.length,
	};
});
