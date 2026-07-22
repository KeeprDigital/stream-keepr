import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';

export default defineEventHandler(async (event) => {
	const params = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const eventId = params.id;

	return await meleeSyncModule().syncEventStructure(event, eventId);
});
