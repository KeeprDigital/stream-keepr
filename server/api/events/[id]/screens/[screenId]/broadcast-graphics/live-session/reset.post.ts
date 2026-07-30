import { broadcastGraphicsLiveSessionModule } from '~~/server/modules/broadcast-graphics-live-session';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

/**
 * Reset a Broadcast Graphics Screen's live state.
 *
 * Ends the current Broadcast Graphics Live Session, turns every Broadcast Graphic
 * off, and opens a fresh epoch that stale commands from the old one cannot reach.
 * It is addressed to the Screen rather than to an epoch on purpose: this is the
 * one action an operator needs when the epoch they hold is unusable, so requiring
 * them to name it would make it unreachable exactly when it matters.
 */
export default defineEventHandler(async (event) => {
	const { id, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	return await broadcastGraphicsLiveSessionModule().resetLiveState({
		eventId: id,
		screenId,
		originConnectionId: getOriginConnectionId(event),
	});
});
