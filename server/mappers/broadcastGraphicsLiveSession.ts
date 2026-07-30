import type { DbBroadcastGraphicsSession } from '~~/server/db/schema';
import type { BroadcastGraphicsSessionResponse } from '~~/shared/types/broadcastGraphicsSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapBroadcastGraphicsSessionToResponse(
	session: DbBroadcastGraphicsSession,
): BroadcastGraphicsSessionResponse {
	return mapTimestamps(session);
}
