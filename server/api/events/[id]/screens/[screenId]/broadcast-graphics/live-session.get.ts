import { broadcastGraphicsLiveSessionModule } from '~~/server/modules/broadcast-graphics-live-session';
import { screenParamsSchema } from '~~/server/schemas/api/screen';

/**
 * The authoritative Broadcast Graphics Live Session snapshot.
 *
 * Every Live Control and Screen Output loads and reloads playout through here.
 * Realtime messages only announce that this snapshot has moved on.
 */
export default defineEventHandler(async (event) => {
	const { id, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	return await broadcastGraphicsLiveSessionModule().loadSession(id, screenId);
});
