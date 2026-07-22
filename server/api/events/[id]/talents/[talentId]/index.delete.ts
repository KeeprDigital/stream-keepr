import { talentWriteModule } from '~~/server/modules/talent-write';
import { talentParamsSchema } from '~~/server/schemas/api/talent';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id: eventId, talentId } = await getValidatedRouterParams(event, talentParamsSchema.parse);

	return await talentWriteModule().deleteTalent({
		eventId,
		talentId,
		originConnectionId: getOriginConnectionId(event),
	});
});
