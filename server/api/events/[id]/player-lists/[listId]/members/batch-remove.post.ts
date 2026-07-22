import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { batchRemoveMembersSchema, playerListParamsSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);
	const body = await readValidatedBody(event, batchRemoveMembersSchema.parse);

	return await playerListWriteModule().batchRemovePlayerListMembers({
		eventId: id,
		listId,
		playerIds: body.playerIds,
		originConnectionId: getOriginConnectionId(event),
	});
});
