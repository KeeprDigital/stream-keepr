import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommandAppliedPayload,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import {
	broadcastGraphicsLiveStateChange,
	broadcastGraphicsRecoveryFault,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { MAX_REALTIME_MESSAGE_BYTES, realtimeMessageBytes } from '~~/shared/types/messages';

/**
 * The snapshot every Live Control and Screen Output reads, recovered on the way out.
 *
 * It deliberately does *not* carry the authoritative clock, even though every
 * effective start time inside it was stamped with one. A reader has to project on that
 * clock rather than its own, but `useServerTime` already establishes it installation-wide
 * with round-trip compensation over several samples and a periodic re-sync — which is
 * both more accurate than one snapshot read could be and shared with every other live
 * surface, so the Feature Match Session clock and Broadcast Graphics playout cannot
 * disagree about what time it is. Restating it here would add bytes to the largest
 * response this feature serves, to worse effect.
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
 * `currentState` is what the operator's own client caches as the authoritative state;
 * `session` is the snapshot it caches it inside. Deriving them separately — the
 * obvious shape, since the raw row is right there — lets a client be handed a
 * recovered `session` alongside a raw `currentState` that disagrees with it, and it
 * would then act on the unreadable state as though it were authoritative while its
 * own fault flag said otherwise. Reading `session.currentState` here is therefore
 * always a bug, and it is one nothing else in the system would catch.
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

/**
 * The realtime notification one accepted command publishes.
 *
 * It answers two questions in one place, because they are the same question: what
 * did this command change, and will saying so actually reach anybody. A message the
 * provider refuses is not a smaller failure than a wrong one — publication logs and
 * swallows, so an oversized notification is indistinguishable from a working show
 * until an output is visibly stale. See #168.
 *
 * So the change is carried when it fits and dropped when it does not, and a dropped
 * change is not a degraded notification: a peer that is told only that the order
 * advanced reloads the authoritative snapshot, which is the same answer it already
 * gives itself for a sequence gap. That is what makes this message bounded by
 * construction — there is no live state large enough to make it undeliverable,
 * because the part that scales with the show is the part that can be left out.
 *
 * The limit it measures against is `MAX_REALTIME_MESSAGE_BYTES`, which is the
 * documented floor rather than this account's confirmed ceiling. Measuring against
 * the floor can only cost a reload that would not have been needed; measuring
 * against a ceiling nobody has established would cost a notification that never
 * arrives.
 */
export function broadcastGraphicsCommandAppliedPayload(
	result: BroadcastGraphicsCommandResult,
	/**
	 * The live state the command was reduced onto.
	 *
	 * Absent when there is none to speak of — a recognised replay is answered with
	 * whatever the session looks like now, which may be many commands newer than the
	 * command being replayed, so no difference from it would be the whole truth.
	 */
	previous: BroadcastGraphicsLiveState | undefined,
	originConnectionId?: string,
): BroadcastGraphicsCommandAppliedPayload {
	const announcement: BroadcastGraphicsCommandAppliedPayload = {
		screenId: result.screenId,
		sessionId: result.sessionId,
		sequence: result.sequence,
		commandType: result.commandType,
	};

	const change = previous ? broadcastGraphicsLiveStateChange(previous, result.currentState) : null;
	if (change === null)
		return announcement;

	const carried = { ...announcement, change };
	const bytes = realtimeMessageBytes(
		result.session.eventId,
		'broadcastGraphicsLiveSession:commandApplied',
		carried,
		originConnectionId,
	);

	return bytes <= MAX_REALTIME_MESSAGE_BYTES ? carried : announcement;
}
