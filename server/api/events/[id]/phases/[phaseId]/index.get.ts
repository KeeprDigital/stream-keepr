import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { phaseParamsSchema } from '~~/server/schemas/api/phase';
import { phaseService } from '~~/server/services/phase';

export default defineEventHandler(async (event) => {
	const { id, phaseId } = await getValidatedRouterParams(event, phaseParamsSchema.parse);

	const phase = await phaseService().findById(phaseId, id);
	if (!phase) {
		throw createError({ statusCode: 404, message: 'Phase not found' });
	}

	return mapPhaseToResponse(phase);
});
