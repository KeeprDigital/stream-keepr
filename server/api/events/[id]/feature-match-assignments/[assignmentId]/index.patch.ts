import { z } from 'zod';
import { featureMatchAssignmentModule } from '~~/server/modules/feature-match-assignment';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { updateFeatureMatchAssignmentSchema } from '~~/server/schemas/api/featureMatchAssignment';

const paramsSchema = eventParamsSchema.extend({ assignmentId: z.coerce.number().int().positive() });

export default defineEventHandler(async (event) => {
	const { id, assignmentId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const input = await readValidatedBody(event, updateFeatureMatchAssignmentSchema.parse);
	return await featureMatchAssignmentModule().update(id, assignmentId, input);
});
