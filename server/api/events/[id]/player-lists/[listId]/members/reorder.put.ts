import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { playerListParamsSchema, reorderMembersSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);
	const body = await readValidatedBody(event, reorderMembersSchema.parse);

	return await playerListWriteModule().reorderPlayerListMembers({
		eventId: id,
		listId,
		playerIds: body.playerIds,
		originConnectionId: getOriginConnectionId(event),
	});
});
