import type { BroadcastGraphicConfig, GraphicAnimationPhase, GraphicPlayoutState } from '~~/shared/types/graphics';

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
 * This state now stores one timestamp per Broadcast Graphic: the authoritative
 * effective start time of the lifecycle phase its latest accepted intent began.
 * That is the field the no-replay invariant used to hold *by accident* — there
 * was nothing to resume — and it is now held on purpose, by three properties
 * that are each asserted as a test rather than promised in prose:
 *
 * 1. **No phase is persisted.** A Graphic Playout State is derived on every read
 *    from the stored intent, the stored start time, and the caller's `now`.
 *    Nothing writes down "entering", so nothing can be resumed as "entering".
 *
 * 2. **Projection saturates rather than wrapping.** Phase progress is monotone in
 *    elapsed time and clamps at completion. A restart, a reload, or a
 *    late-loading output can only ever make elapsed time *larger*, so it can only
 *    resolve a phase further forward — never back to its beginning. A start time
 *    from before a crash is therefore self-healing: by the time anyone reads it,
 *    it is already past its phase duration and settles at the Graphic Resting
 *    State. Recovery does not need to detect staleness or clear the field,
 *    because trusting the field literally is what produces the correct answer.
 *
 * 3. **An idempotent repeat does not refresh the start time.** A duplicate Take
 *    delivered while a graphic is already entering leaves the record untouched,
 *    so a retried command cannot restart an entrance on program. This is where
 *    "duplicate delivery of the same action has no additional effect" stops being
 *    only about the target state and starts being about the animation too.
 *
 * The alternative shapes were both rejected for the same reason: persisting a
 * phase* makes recovery resume it, and persisting a start time that recovery
 * resets* makes recovery replay from it. Persisting one authoritative instant and
 * deriving everything from it is the only shape where the correct behaviour is the
 * behaviour you get by doing nothing special.
 *
 * `cut` is persisted beside it because Cut is a property of the accepted command,
 * not of the animation: it records that this intent was reached without running
 * its corresponding phase. It is a fact about what an operator asked for, which is
 * exactly the kind of thing this state is for, and it is likewise self-healing —
 * a Cut graphic is settled from the instant it is accepted.
 */

/** The latest accepted playout intent for one placed Broadcast Graphic. */
export interface BroadcastGraphicPlayout {
	/** Whether the operator's latest accepted intent puts this graphic on air. */
	onAir: boolean;
	/**
	 * The one authoritative effective start time of the lifecycle phase this intent
	 * began, as epoch milliseconds. Every output and Live Control projects the same
	 * phase from it; nobody acknowledges it, and nothing resets it on recovery.
	 */
	effectiveStartedAt: number;
	/**
	 * Whether this intent was reached with the Cut execution modifier, and so
	 * without running its corresponding Graphic Animation phase.
	 */
	cut: boolean;
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
	 * Graphic Animation phase. It never changes the target itself, so a Cut action
	 * reaches the same on-air intent as its plain counterpart and differs only in
	 * whether the corresponding phase runs.
	 */
	cut?: boolean;
}

/**
 * The authoritative instant a command was accepted at.
 *
 * Supplied by the caller rather than read from a clock here, because this reducer
 * runs on the server and in every client and only one of them is authoritative.
 * The server passes its own clock when it accepts the command; a client replaying
 * the same command onto a snapshot passes the same value it was given.
 */
export interface BroadcastGraphicsPlayoutContext {
	acceptedAt: number;
}

export function createInitialBroadcastGraphicsLiveState(): BroadcastGraphicsLiveState {
	return { playout: {} };
}

export function applyBroadcastGraphicsPlayoutCommand(
	state: BroadcastGraphicsLiveState,
	type: BroadcastGraphicsCommandType,
	payload: BroadcastGraphicsPlayoutPayload,
	context: BroadcastGraphicsPlayoutContext,
): BroadcastGraphicsLiveState {
	const next: BroadcastGraphicPlayout = {
		onAir: type === 'Take',
		effectiveStartedAt: context.acceptedAt,
		cut: payload.cut === true,
	};
	const current = state.playout[payload.graphicId];

	// Idempotent in the strongest sense the vocabulary allows: a repeat of the
	// intent already accepted changes nothing at all, so a duplicated or retried
	// command cannot restart a phase that is already running on program.
	if (current && current.onAir === next.onAir && current.cut === next.cut)
		return state;

	return {
		...state,
		playout: {
			...state.playout,
			[payload.graphicId]: next,
		},
	};
}

/**
 * How long each finite lifecycle phase of one Broadcast Graphic lasts, and the
 * instant to project it at.
 *
 * Durations are supplied rather than looked up because they come from Screen
 * configuration, which this module deliberately does not read: the same reducer
 * has to work against a snapshot with no composition in hand.
 */
export interface BroadcastGraphicPhaseTiming {
	now: number;
	/** The finite duration of each phase, in milliseconds. Absent phases last zero. */
	durations?: Partial<Record<GraphicAnimationPhase, number>>;
}

function phaseDuration(timing: BroadcastGraphicPhaseTiming, phase: GraphicAnimationPhase): number {
	return Math.max(0, timing.durations?.[phase] ?? 0);
}

/**
 * The operator-visible lifecycle status of one placed Broadcast Graphic.
 *
 * Without timing this reports only the settled states — off and on-air — which is
 * what a caller that does not care about animation wants and what recovery
 * resolves to by definition. With timing it additionally reports entering and
 * exiting, derived from the authoritative effective start time and clamped by the
 * phase's own duration, so a graphic whose phase has elapsed is settled rather
 * than mid-flight however long ago that phase started.
 *
 * Waiting and updating arrive with the Graphic Channel handoff and Graphic Input
 * acceptance that produce them.
 */
export function broadcastGraphicPlayoutState(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	timing?: BroadcastGraphicPhaseTiming,
): GraphicPlayoutState {
	const playout = state.playout[graphicId];
	if (!playout)
		return 'off';

	const settled = playout.onAir ? 'on-air' : 'off';
	// Cut reaches its target immediately, so there is no phase to be inside of.
	if (!timing || playout.cut)
		return settled;

	const phase = playout.onAir ? 'enter' : 'exit';
	const duration = phaseDuration(timing, phase);
	if (duration <= 0)
		return settled;

	const elapsed = timing.now - playout.effectiveStartedAt;
	if (elapsed >= duration)
		return settled;

	return playout.onAir ? 'entering' : 'exiting';
}

/**
 * The lifecycle phase and elapsed time one Broadcast Graphic's Screen Output
 * should render, or null while it is settled or off.
 *
 * This is the seam a Screen Output and the Program monitor project animation
 * through: one phase and one elapsed time, both derived, so a late-loading or
 * reconnected output catches up to the current authoritative phase instead of
 * replaying it from the beginning.
 */
export function broadcastGraphicPhaseProjection(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	timing: BroadcastGraphicPhaseTiming,
): { phase: GraphicAnimationPhase; elapsed: number } | null {
	const status = broadcastGraphicPlayoutState(state, graphicId, timing);
	if (status !== 'entering' && status !== 'exiting')
		return null;

	const playout = state.playout[graphicId]!;
	return {
		phase: status === 'entering' ? 'enter' : 'exit',
		elapsed: Math.max(0, timing.now - playout.effectiveStartedAt),
	};
}

/**
 * Which of the Screen's authored Broadcast Graphics compose into the frame,
 * back to front.
 *
 * Derived from the authored stack rather than from the live state's own key
 * order, so Take timing cannot reorder the composition and live state left
 * behind by a since-deleted Broadcast Graphic cannot render.
 *
 * An exiting Broadcast Graphic is still on program, so it composes: a graphic
 * leaves the frame when its exit phase completes, not when Out is accepted.
 */
export function onAirBroadcastGraphicIds(
	state: BroadcastGraphicsLiveState,
	graphics: readonly Pick<BroadcastGraphicConfig, 'id'>[],
	timing?: BroadcastGraphicPhaseTiming,
): string[] {
	return graphics
		.filter((graphic) => {
			const status = broadcastGraphicPlayoutState(state, graphic.id, timing);
			// A waiting graphic is absent from every program output; off is off.
			return status !== 'off' && status !== 'waiting';
		})
		.map(graphic => graphic.id);
}
