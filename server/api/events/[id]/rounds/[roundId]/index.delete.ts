import { roundWriteModule } from '~~/server/modules/round-write';
import { roundParamsSchema } from '~~/server/schemas/api/round';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, roundId } = await getValidatedRouterParams(event, roundParamsSchema.parse);

	await roundWriteModule().remove({
		eventId: id,
		roundId,
		originConnectionId: getOriginConnectionId(event),
	});

	return { success: true };
});
