import { matchWriteModule } from '~~/server/modules/match-write';
import { matchParamsSchema } from '~~/server/schemas/api/match';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, matchId } = await getValidatedRouterParams(event, matchParamsSchema.parse);

	await matchWriteModule().remove({
		eventId: id,
		matchId,
		originConnectionId: getOriginConnectionId(event),
	});

	return { success: true };
});
