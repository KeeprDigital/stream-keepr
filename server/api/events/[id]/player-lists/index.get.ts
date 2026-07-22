import { mapPlayerListToSummaryResponse } from '~~/server/mappers/playerList';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { playerListService } from '~~/server/services/playerList';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const lists = await playerListService().findByEventId(id);

	return {
		playerLists: lists.map(mapPlayerListToSummaryResponse),
		total: lists.length,
	};
});
