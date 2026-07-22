import { roundControlModule } from '~~/server/modules/round-control';
import { roundParamsSchema } from '~~/server/schemas/api/round';

export default defineEventHandler(async (event) => {
	const { id, roundId } = await getValidatedRouterParams(event, roundParamsSchema.parse);
	return await roundControlModule().enableManualOverride(event, id, roundId);
});
