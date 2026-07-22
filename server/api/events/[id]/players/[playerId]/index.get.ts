import { mapPlayerToResponse } from '~~/server/mappers/player';
import { playerParamsSchema } from '~~/server/schemas/api/player';
import { playerService } from '~~/server/services/player';

export default defineEventHandler(async (event) => {
	const { id, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);

	const player = await playerService().findById(playerId, id);
	if (!player) {
		throw createError({
			statusCode: 404,
			message: 'Player not found',
		});
	}

	return mapPlayerToResponse(player);
});
