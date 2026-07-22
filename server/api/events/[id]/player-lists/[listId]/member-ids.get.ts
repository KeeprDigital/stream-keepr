import { playerListParamsSchema } from '~~/server/schemas/api/playerList';
import { playerListService } from '~~/server/services/playerList';

export default defineEventHandler(async (event) => {
	const { id, listId } = await getValidatedRouterParams(event, playerListParamsSchema.parse);

	const memberIds = await playerListService().getMemberPlayerIds(listId, id);

	return { memberIds };
});
