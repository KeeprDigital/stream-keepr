import { mapPlayerToResponse } from '~~/server/mappers/player';
import { mapPlayerListToResponse } from '~~/server/mappers/playerList';
import { playerListParamsSchema } from '~~/server/schemas/api/playerList';
import { playerListService } from '~~/server/services/playerList';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);

	const result = await playerListService().findByIdWithMembers(listId, id);

	if (!result) {
		throw createError({
			statusCode: 404,
			message: 'Player list not found',
		});
	}

	return {
		...mapPlayerListToResponse(result),
		members: result.members.map(mapPlayerToResponse),
	};
});
