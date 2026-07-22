import { talentWriteModule } from '~~/server/modules/talent-write';
import { talentParamsSchema, updateTalentSchema } from '~~/server/schemas/api/talent';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id: eventId, talentId } = await getValidatedRouterParams(event, talentParamsSchema.parse);
	const body = await readValidatedBody(event, updateTalentSchema.parse);

	return await talentWriteModule().updateTalent({
		eventId,
		talentId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
