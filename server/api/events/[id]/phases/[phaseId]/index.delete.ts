import { phaseWriteModule } from '~~/server/modules/phase-write';
import { phaseParamsSchema } from '~~/server/schemas/api/phase';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, phaseId } = await getValidatedRouterParams(event, phaseParamsSchema.parse);

	await phaseWriteModule().remove({
		eventId: id,
		phaseId,
		originConnectionId: getOriginConnectionId(event),
	});

	return { success: true };
});
