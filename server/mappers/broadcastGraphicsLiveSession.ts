import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

/**
 * The snapshot every Live Control and Screen Output reads, stamped with the clock
 * that wrote its effective start times.
 *
 * `serverTime` is read here rather than by the caller so that no path can return a
 * snapshot without it: a client that receives playout timestamps and no authoritative
 * clock has no choice but to subtract its own, which is the failure this exists to
 * remove.
 */
export function mapBroadcastGraphicsLiveSessionToResponse(
	session: DbBroadcastGraphicsLiveSession,
): BroadcastGraphicsLiveSessionResponse {
	return { ...mapTimestamps(session), serverTime: Date.now() };
}
