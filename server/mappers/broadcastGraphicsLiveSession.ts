import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

/**
 * The snapshot every Live Control and Screen Output reads.
 *
 * It deliberately does *not* carry the authoritative clock, even though every
 * effective start time inside it was stamped with one. A reader has to project on that
 * clock rather than its own, but `useServerTime` already establishes it installation-wide
 * with round-trip compensation over several samples and a periodic re-sync — which is
 * both more accurate than one snapshot read could be and shared with every other live
 * surface, so the Feature Match Session clock and Broadcast Graphics playout cannot
 * disagree about what time it is. Restating it here would add bytes to a payload that is
 * already the largest thing this feature publishes, to worse effect.
 */
export function mapBroadcastGraphicsLiveSessionToResponse(
	session: DbBroadcastGraphicsLiveSession,
): BroadcastGraphicsLiveSessionResponse {
	return mapTimestamps(session);
}
