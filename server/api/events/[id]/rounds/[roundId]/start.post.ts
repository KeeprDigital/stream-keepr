import { roundWriteModule } from '~~/server/modules/round-write';
import { roundParamsSchema } from '~~/server/schemas/api/round';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** "Start now": the Round's start becomes server time (ADR-0066). */
export default defineEventHandler(async (event) => {
	const { id, roundId } = await getValidatedRouterParams(event, roundParamsSchema.parse);

	return await roundWriteModule().start({
		eventId: id,
		roundId,
		originConnectionId: getOriginConnectionId(event),
	});
});
