import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsCommandType,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsRecoveryFault,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * A Broadcast Graphics Live Session is either the Screen's current playout epoch
 * or a closed one. An ended epoch keeps its row so a stale retry can be answered
 * with a rejection rather than silently affecting a later show.
 */
export const BROADCAST_GRAPHICS_LIVE_SESSION_STATUS_VALUES = ['active', 'ended'] as const;

export type BroadcastGraphicsLiveSessionStatus = typeof BROADCAST_GRAPHICS_LIVE_SESSION_STATUS_VALUES[number];

/** The authoritative snapshot every Live Control and Screen Output reloads. */
export interface BroadcastGraphicsLiveSessionResponse {
	id: number;
	eventId: number;
	screenId: number;
	status: BroadcastGraphicsLiveSessionStatus;
	/**
	 * The live state every reader acts on.
	 *
	 * Already recovered: durable state that could not be trusted is reported through
	 * `recoveryFault` and replaced here by a state with nothing on air, so no client
	 * can accidentally render half of an unreadable session.
	 */
	currentState: BroadcastGraphicsLiveState;
	/**
	 * Why the durable live state behind this snapshot could not be trusted, when it
	 * could not. Present until an explicit playout action writes a state that can be.
	 */
	recoveryFault: BroadcastGraphicsRecoveryFault | null;
	sequence: number;
	endedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * One action, named by a stable command id so a retry is recognisable.
 *
 * Unlike an absolute Feature Match Session command there is no base sequence:
 * Take and Out state the latest desired on-air state of one Broadcast Graphic,
 * so a session that has advanced does not invalidate them. The last accepted
 * conflicting intent is meant to win.
 *
 * Update Graphic is the exception, and it carries its own guard in its payload
 * rather than a session-wide base sequence: it supersedes one *acceptance*, so a
 * newer acceptance of the same graphic's Graphic Inputs is the only thing that
 * invalidates it. An unrelated Take does not.
 */
export type BroadcastGraphicsCommand = BroadcastGraphicsCommandInput & { commandId: string };

/** The realtime notification that the authoritative order has advanced. */
export interface BroadcastGraphicsCommandAppliedPayload {
	screenId: number;
	sessionId: number;
	sequence: number;
	commandType: BroadcastGraphicsCommandType;
	currentState: BroadcastGraphicsLiveState;
}

export interface BroadcastGraphicsCommandResult extends BroadcastGraphicsCommandAppliedPayload {
	session: BroadcastGraphicsLiveSessionResponse;
}

/**
 * The realtime notification that a Screen's playout epoch has been replaced.
 *
 * Deliberately carries no state at all. A client cannot apply an epoch change —
 * whatever it holds belongs to a session that has ended, and the snapshot is the
 * only thing that can say which epoch is current and what it starts from. So this
 * says only "stop trusting what you have", which is what every reload path this
 * notification triggers already knows how to answer.
 *
 * ## Which epoch endings publish it, and why
 *
 * An explicit live-state reset is the case that *needs* it: the Screen is unchanged,
 * so no other message is published, and without this every peer would sit on the
 * ended epoch — still rendering the graphics the reset was meant to clear.
 *
 * A mode change publishes it too, but as belt and braces rather than necessity:
 * `screen:updated` already reaches every client, including Screen Outputs, and an
 * output renders by the Screen's current mode, so it stops composing graphics on its
 * own. This makes the cached epoch go deterministically rather than as a
 * side effect of a component remount.
 *
 * A Screen delete deliberately publishes nothing. Those clients are about to be told
 * the Screen itself is gone, and pointing them at a snapshot route that will now
 * refuse them would surface a spurious failure on the way out.
 */
export interface BroadcastGraphicsEpochEndedPayload {
	screenId: number;
	/**
	 * The epoch that ended, or null when the Screen had none open.
	 *
	 * Diagnostic rather than load-bearing: an epoch ending invalidates whatever a
	 * client holds for that Screen whichever epoch it was, so no client decides
	 * anything from this.
	 */
	sessionId: number | null;
}
