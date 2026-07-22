import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';

/**
 * Sync Deck Lists from Melee.gg.
 */
export default defineEventHandler(async (event) => {
	const params = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const eventId = params.id;

	return await meleeSyncModule().syncDeckLists(event, eventId);
});
