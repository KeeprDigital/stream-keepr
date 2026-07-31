import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type {
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import {
	broadcastGraphicsRecoveryFault,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * The snapshot every Live Control and Screen Output reads, recovered on the way out.
 *
 * It deliberately does *not* carry the authoritative clock, even though every
 * effective start time inside it was stamped with one. A reader has to project on that
 * clock rather than its own, but `useServerTime` already establishes it installation-wide
 * with round-trip compensation over several samples and a periodic re-sync — which is
 * both more accurate than one snapshot read could be and shared with every other live
 * surface, so the Feature Match Session clock and Broadcast Graphics playout cannot
 * disagree about what time it is. Restating it here would add bytes to a payload that is
 * already the largest thing this feature publishes, to worse effect.
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

/**
 * One accepted command's answer, and the notification derived from it.
 *
 * Both halves come from **one** mapped snapshot, and that is the whole reason this
 * is a named function rather than an object literal inside the live-state port.
 * `currentState` is what a peer applies in place on the realtime path; `session` is
 * what the caller caches. Deriving them separately — the obvious shape, since the
 * raw row is right there — lets a client be handed a recovered `session` alongside a
 * raw `currentState` that disagrees with it, and the peer would then apply the
 * unreadable state as though it were authoritative while its own fault flag said
 * otherwise. Reading `session.currentState` here is therefore always a bug, and it
 * is one nothing else in the system would catch.
 */
export function mapBroadcastGraphicsCommandResult(
	session: DbBroadcastGraphicsLiveSession,
	commandType: BroadcastGraphicsCommandResult['commandType'],
): BroadcastGraphicsCommandResult {
	const mapped = mapBroadcastGraphicsLiveSessionToResponse(session);

	return {
		screenId: session.screenId,
		sessionId: session.id,
		sequence: session.sequence,
		commandType,
		currentState: mapped.currentState,
		session: mapped,
	};
}
