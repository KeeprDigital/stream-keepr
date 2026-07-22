import { featureMatchAssignmentModule } from '~~/server/modules/feature-match-assignment';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createFeatureMatchAssignmentSchema } from '~~/server/schemas/api/featureMatchAssignment';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const input = await readValidatedBody(event, createFeatureMatchAssignmentSchema.parse);
	return await featureMatchAssignmentModule().save(id, input);
});
