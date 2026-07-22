import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	return await meleeSyncModule().runInitialSetup(event, eventId);
});
