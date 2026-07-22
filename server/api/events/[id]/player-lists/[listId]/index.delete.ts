import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { playerListParamsSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);

	return await playerListWriteModule().deletePlayerList({
		eventId: id,
		listId,
		originConnectionId: getOriginConnectionId(event),
	});
});
