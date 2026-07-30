import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsCommandType,
	BroadcastGraphicsLiveState,
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
	currentState: BroadcastGraphicsLiveState;
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
