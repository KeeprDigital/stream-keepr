import type {
	BroadcastGraphicsCommandType,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsPlayoutPayload,
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
 * One playout action, named by a stable command id so a retry is recognisable.
 *
 * Unlike an absolute Feature Match Session command there is no base sequence:
 * Take and Out state the latest desired on-air state of one Broadcast Graphic,
 * so a session that has advanced does not invalidate them. The last accepted
 * conflicting intent is meant to win.
 */
export interface BroadcastGraphicsCommand {
	commandId: string;
	type: BroadcastGraphicsCommandType;
	payload: BroadcastGraphicsPlayoutPayload;
}

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
