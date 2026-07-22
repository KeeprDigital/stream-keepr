import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { phaseService } from '~~/server/services/phase';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const phases = await phaseService().findByEventId(id);
	return {
		phases: phases.map(mapPhaseToResponse),
		total: phases.length,
	};
});
