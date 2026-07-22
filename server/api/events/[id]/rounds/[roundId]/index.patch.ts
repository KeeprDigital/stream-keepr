import { roundWriteModule } from '~~/server/modules/round-write';
import { roundParamsSchema, updateRoundSchema } from '~~/server/schemas/api/round';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, roundId } = await getValidatedRouterParams(event, roundParamsSchema.parse);
	const body = await readValidatedBody(event, updateRoundSchema.parse);

	return await roundWriteModule().update({
		eventId: id,
		roundId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
