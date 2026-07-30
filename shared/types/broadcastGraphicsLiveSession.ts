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
 * It is published for a mode change, a Screen delete, and an explicit live-state
 * reset alike: from a Live Control's or a Screen Output's point of view those are
 * the same event, and the difference between them is not something a client acts
 * on differently.
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
