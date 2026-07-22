import { z } from 'zod';
import { featureMatchAssignmentModule } from '~~/server/modules/feature-match-assignment';
import { eventParamsSchema } from '~~/server/schemas/api/event';

const querySchema = z.object({
	roundId: z.coerce.number().int().positive(),
});

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const { roundId } = await getValidatedQuery(event, querySchema.parse);
	return await featureMatchAssignmentModule().listByRound(id, roundId);
});
