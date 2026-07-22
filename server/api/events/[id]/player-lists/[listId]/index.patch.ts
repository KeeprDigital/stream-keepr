import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { playerListParamsSchema, updatePlayerListSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);
	const body = await readValidatedBody(event, updatePlayerListSchema.parse);

	return await playerListWriteModule().updatePlayerList({
		eventId: id,
		listId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
