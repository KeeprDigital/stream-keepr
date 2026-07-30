import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import {
	broadcastGraphicsRecoveryFault,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * The authoritative snapshot, recovered on the way out.
 *
 * Every read of a Broadcast Graphics Live Session goes through here — the snapshot
 * route, every command result, and the realtime notification derived from one — so
 * this is where durable live state stops being raw JSON from a text column and
 * becomes state a reader may act on. Recovering here rather than at each call site
 * is what makes "unreadable live state renders every output transparent" true of
 * every path at once rather than of the paths someone remembered.
 *
 * The fault travels with the snapshot rather than replacing it: an operator needs
 * both facts at once — nothing is on air, and this is why — and Live Control cannot
 * show the second without being told it.
 */
export function mapBroadcastGraphicsLiveSessionToResponse(
	session: DbBroadcastGraphicsLiveSession,
): BroadcastGraphicsLiveSessionResponse {
	return {
		...mapTimestamps(session),
		currentState: recoveredBroadcastGraphicsLiveState(session.currentState),
		recoveryFault: broadcastGraphicsRecoveryFault(session.currentState),
	};
}
