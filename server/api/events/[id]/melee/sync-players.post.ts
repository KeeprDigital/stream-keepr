import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';

/**
 * Sync Players and standings from Melee.gg.
 * This does not sync Deck Lists — use /melee/sync-decklists for that.
 */
export default defineEventHandler(async (event) => {
	const params = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const eventId = params.id;

	return await meleeSyncModule().syncPlayers(event, eventId);
});
