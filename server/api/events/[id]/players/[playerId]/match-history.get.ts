import { playerParamsSchema } from '~~/server/schemas/api/player';
import { findPlayerMatchHistory } from '~~/server/services/playerMatchHistory';

export default defineEventHandler(async (event) => {
	const { id: eventId, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);

	const result = await findPlayerMatchHistory(eventId, playerId);
	if (!result) {
		throw createError({ statusCode: 404, message: 'Player not found' });
	}

	return result;
});
