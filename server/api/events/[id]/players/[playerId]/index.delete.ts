import { playerUpdateModule } from '~~/server/modules/player-update';
import { playerParamsSchema } from '~~/server/schemas/api/player';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);

	return await playerUpdateModule().deletePlayer({
		eventId: id,
		playerId,
		originConnectionId: getOriginConnectionId(event),
	});
});
