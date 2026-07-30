import type { BroadcastGraphicConfig, GraphicPlayoutState } from '~~/shared/types/graphics';

/**
 * Broadcast Graphics playout reduction.
 *
 * Shared isomorphic domain logic: the server reduces accepted commands with it
 * and every client derives what is on air from the same functions, so operator
 * UI and Screen Outputs can never disagree about the authoritative order's
 * meaning.
 *
 * ## Target state, not queued events
 *
 * Take and Out express the latest desired on-air state of one Broadcast
 * Graphic. Reducing them is therefore an assignment rather than a transition:
 * repeating either is idempotent by construction, and the last accepted
 * conflicting intent wins because it simply overwrites the previous one. Each
 * command owns exactly one Broadcast Graphic's field, so intents for different
 * graphics never interfere.
 *
 * ## Why recovery cannot replay animation
 *
 * The state below stores the accepted *intent* and nothing else — no lifecycle
 * phase, no phase start time. A Graphic Playout State is derived from that
 * intent on every read, so a reload, disconnect, or server restart can only
 * ever resolve a target-on-air Broadcast Graphic to settled on air at its
 * Graphic Resting State. There is no stored phase for recovery to resume.
 * Graphic Animation adds the entering, updating, and exiting states by deriving
 * them from an authoritative effective start time, which is likewise computed
 * rather than persisted mid-flight.
 */

/** The latest accepted playout intent for one placed Broadcast Graphic. */
export interface BroadcastGraphicPlayout {
	/** Whether the operator's latest accepted intent puts this graphic on air. */
	onAir: boolean;
}

/**
 * The live state of a Broadcast Graphics Live Session.
 *
 * Keyed by Broadcast Graphic id rather than ordered, because Take timing never
 * affects rendering order: concurrent graphics always composite in the Screen's
 * authored stack order, which lives in Screen configuration.
 */
export interface BroadcastGraphicsLiveState {
	playout: Record<string, BroadcastGraphicPlayout>;
}

/** The playout actions a Broadcast Graphics Live Session accepts. */
export const BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES = ['Take', 'Out'] as const;

export type BroadcastGraphicsCommandType = typeof BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES[number];

export interface BroadcastGraphicsPlayoutPayload {
	graphicId: string;
	/**
	 * The Cut execution modifier: reach the action's target without running its
	 * Graphic Animation phase. It never changes the target itself, so while
	 * animation does not exist a Cut action is indistinguishable from its plain
	 * counterpart — it is still accepted in the authoritative order so that
	 * operators, clients, and receipts record the intent they actually issued.
	 */
	cut?: boolean;
}

export function createInitialBroadcastGraphicsLiveState(): BroadcastGraphicsLiveState {
	return { playout: {} };
}

export function applyBroadcastGraphicsPlayoutCommand(
	state: BroadcastGraphicsLiveState,
	type: BroadcastGraphicsCommandType,
	payload: BroadcastGraphicsPlayoutPayload,
): BroadcastGraphicsLiveState {
	return {
		...state,
		playout: {
			...state.playout,
			[payload.graphicId]: { onAir: type === 'Take' },
		},
	};
}

/**
 * The operator-visible lifecycle status of one placed Broadcast Graphic.
 *
 * Only off and on-air are reachable until Graphic Animation exists; waiting,
 * entering, updating, and exiting arrive with the animation and Graphic Channel
 * vocabulary that produces them.
 */
export function broadcastGraphicPlayoutState(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
): GraphicPlayoutState {
	return state.playout[graphicId]?.onAir ? 'on-air' : 'off';
}

/**
 * Which of the Screen's authored Broadcast Graphics compose into the frame,
 * back to front.
 *
 * Derived from the authored stack rather than from the live state's own key
 * order, so Take timing cannot reorder the composition and live state left
 * behind by a since-deleted Broadcast Graphic cannot render.
 */
export function onAirBroadcastGraphicIds(
	state: BroadcastGraphicsLiveState,
	graphics: readonly Pick<BroadcastGraphicConfig, 'id'>[],
): string[] {
	return graphics
		.filter(graphic => broadcastGraphicPlayoutState(state, graphic.id) === 'on-air')
		.map(graphic => graphic.id);
}
