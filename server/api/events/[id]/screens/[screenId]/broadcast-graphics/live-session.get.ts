import { broadcastGraphicsSessionModule } from '~~/server/modules/broadcast-graphics-session';
import { broadcastGraphicsScreenParamsSchema } from '~~/server/schemas/api/broadcastGraphicsSession';

/**
 * The authoritative Broadcast Graphics Live Session snapshot.
 *
 * Every Live Control and Screen Output loads and reloads playout through here.
 * Realtime messages only announce that this snapshot has moved on.
 */
export default defineEventHandler(async (event) => {
	const { id, screenId } = await getValidatedRouterParams(event, broadcastGraphicsScreenParamsSchema.parse);

	return await broadcastGraphicsSessionModule().loadSession(id, screenId);
});
