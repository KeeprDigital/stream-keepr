import { broadcastGraphicsLiveSessionModule } from '~~/server/modules/broadcast-graphics-live-session';
import { requireScreenOutputRead } from '~~/server/utils/screenOutputRead';

/**
 * The authoritative Broadcast Graphics Live Session snapshot, for this Screen's
 * outputs (#604). The same snapshot Live Control reads privately; realtime only
 * announces that it has moved on.
 */
export default defineEventHandler(async (event) => {
	const { eventId, screen } = await requireScreenOutputRead(event);
	return await broadcastGraphicsLiveSessionModule().loadSession(eventId, screen.id);
});
