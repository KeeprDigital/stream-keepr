import { matchWriteModule } from '~~/server/modules/match-write';
import { matchParamsSchema, updateMatchSchema } from '~~/server/schemas/api/match';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, matchId } = await getValidatedRouterParams(event, matchParamsSchema.parse);
	const body = await readValidatedBody(event, updateMatchSchema.parse);

	return await matchWriteModule().update({
		eventId: id,
		matchId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
