import { playerUpdateModule } from '~~/server/modules/player-update';
import { playerParamsSchema, updatePlayerSchema } from '~~/server/schemas/api/player';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);
	const body = await readValidatedBody(event, updatePlayerSchema.parse);
	const originConnectionId = getOriginConnectionId(event);

	return await playerUpdateModule().updatePlayer({
		eventId: id,
		playerId,
		input: body,
		originConnectionId,
	});
});
