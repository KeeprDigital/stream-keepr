import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapBroadcastGraphicsLiveSessionToResponse(
	session: DbBroadcastGraphicsLiveSession,
): BroadcastGraphicsLiveSessionResponse {
	return mapTimestamps(session);
}
