import { playerListWriteModule } from '~~/server/modules/player-list-write';
import { addMembersSchema, playerListParamsSchema } from '~~/server/schemas/api/playerList';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);
	const body = await readValidatedBody(event, addMembersSchema.parse);

	const response = await playerListWriteModule().addPlayerListMembers({
		eventId: id,
		listId,
		playerIds: body.playerIds,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
