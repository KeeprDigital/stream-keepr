import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { playerListMemberParamsSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId, playerId } = await getValidatedRouterParams(event, playerListMemberParamsSchema.parse);

	return await playerListWriteModule().removePlayerListMember({
		eventId: id,
		listId,
		playerId,
		originConnectionId: getOriginConnectionId(event),
	});
});
