import { phaseWriteModule } from '~~/server/modules/phase-write';
import { phaseParamsSchema, updatePhaseSchema } from '~~/server/schemas/api/phase';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, phaseId } = await getValidatedRouterParams(event, phaseParamsSchema.parse);
	const body = await readValidatedBody(event, updatePhaseSchema.parse);

	return await phaseWriteModule().update({
		eventId: id,
		phaseId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
