import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { BroadcastGraphicInputsState, GraphicInputValues } from './inputs';
import {
	broadcastGraphicHasPhaseAnimation,
	broadcastGraphicPhaseDurations,
	findGraphicInputDeclaration,
	graphicInputAvailability,
} from '~~/shared/modules/graphics';
import {
	acceptGraphicInputValues,
	broadcastGraphicInputsState,
	createInitialBroadcastGraphicInputsState,
	isDeclaredGraphicInput,
	resolveGraphicInputValues,
	sameGraphicInputValues,
	unavailableRequiredGraphicInputs,
} from './inputs';
import { BroadcastGraphicsCommandRejection } from './rejection';

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
 * This state stores one timestamp per Broadcast Graphic: the authoritative
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
 * 3. **An idempotent repeat does not refresh the start time.** A repeat of the
 *    intent already accepted leaves the record untouched, so a retried command
 *    cannot restart an entrance on program. This is where "duplicate delivery of
 *    the same action has no additional effect" stops being only about the target
 *    state and starts being about the animation too.
 *
 * The alternative shapes were both rejected for the same reason: persisting a
 * phase* makes recovery resume it, and persisting a start time that recovery
 * resets* makes recovery replay from it. Persisting one authoritative instant and
 * deriving everything from it is the only shape where the correct behaviour is the
 * behaviour you get by doing nothing special.
 *
 * ## The two fields live playout added, and why they keep the same property
 *
 * Live animation needs two things a single start time cannot express, and both are
 * written in the one form that stays self-healing under a stale read: a value that
 * is *monotone in `now`* and *saturates at the settled state of the intent that
 * wrote it*. That is the property, not "correct when fresh" — a reader that has
 * been asleep for four hours must land on the resting state without anyone
 * detecting, validating, or clearing anything.
 *
 * 1. **`reversalCompletesAt`** — where an interruption began. Out during enter has
 *    to reverse the entrance *from the currently rendered state*, and the rendered
 *    state of every owner in the graphic is a pure function of one number in phase
 *    time, so one number is all that has to be stored. It is stored as the
 *    reversal's scheduled *completion* instant rather than as a start plus a
 *    length, for two reasons: the length is not derivable from Screen configuration
 *    (it depends on when the operator pressed), and a completion instant needs
 *    nothing at all from configuration to settle — `now >= reversalCompletesAt` is
 *    the whole test. Projected elapsed time is `reversalCompletesAt - now`, which
 *    falls monotonically to zero and clamps there; zero is the *far* end of the
 *    reversed phase, which for a reversed enter is fully off and for a reversed exit
 *    is the Graphic Resting State. Both are exactly the settled state of the intent
 *    that reversed. A stale read is therefore not merely harmless, it is right.
 *
 * 2. **`updateStartedAt`** — the one authoritative effective start time of the
 *    update phase, deferred at acceptance past an enter still in flight or an update
 *    still running, because coalescing is a fact about the authoritative order and
 *    not about any one output's clock. The rendering pair it transitions between
 *    lives beside the accepted values it is made of, and `rollUpdateChain` is the
 *    single normalisation both the reducer and every reader use: it walks the chain
 *    forward to `now` and returns nothing once the chain is spent. Monotone,
 *    saturating, and it needs no cleanup — an update accepted before a restart has
 *    completed by the time anything looks, so what is read is the accepted values at
 *    rest.
 *
 * Neither field names a lifecycle phase. Which phase a reversal reverses is derived
 * from the intent that interrupted it — an intent that is now off air reversed an
 * enter — so property 1 above still holds: nothing writes down "entering", so
 * nothing can be resumed as "entering".
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
	 * without running its corresponding Graphic Animation phase. It is a fact about
	 * what the operator asked for rather than about the animation, which is why it
	 * belongs beside the intent it modifies.
	 */
	cut: boolean;
	/**
	 * When the reversal this intent started is scheduled to complete, present only
	 * while this intent interrupted a phase that was still in flight.
	 *
	 * Its absence is the ordinary case and is what keeps a graphic that was never
	 * interrupted storing exactly the three fields #64 asserted. Which phase is being
	 * reversed follows from `onAir`: an intent that took the graphic off air reversed
	 * its enter, and one that brought it back on air reversed its exit.
	 */
	reversalCompletesAt?: number;
	/**
	 * The one authoritative effective start time of this Broadcast Graphic's update
	 * phase, present only while an accepted set of Graphic Input changes has an update
	 * animation still to run.
	 *
	 * Already deferred: an acceptance during enter is scheduled at enter's completion
	 * and one during an update at that update's completion, so every output reads a
	 * single instant and none of them has to work out the coalescing for itself.
	 */
	updateStartedAt?: number;
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
	/** Working and accepted Graphic Input values, per placed Broadcast Graphic. */
	inputs: Record<string, BroadcastGraphicInputsState>;
}

/** The actions a Broadcast Graphics Live Session accepts. */
export const BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES = [
	'Take',
	'Out',
	'Update Graphic',
	'Set Input',
] as const;

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

/**
 * One atomic acceptance of a Broadcast Graphic's staged Graphic Inputs.
 *
 * `basedOnAcceptedRevision` is the sequence guard: the acceptance names the one
 * it supersedes, so an operator whose Live Control has fallen behind another
 * operator's acceptance is refused rather than silently overwriting it. Cut
 * Update is this same intent with the modifier set, never a second intent — which
 * is also why a retry of it keeps its own command id.
 */
export interface BroadcastGraphicsUpdatePayload extends BroadcastGraphicsPlayoutPayload {
	basedOnAcceptedRevision: number;
}

/**
 * One edit to a declared Graphic Input's working value.
 *
 * The value is stored as the operator entered it, even when it violates the
 * declaration: it is reported unavailable rather than coerced, so Live Control can
 * show what was entered and why it cannot go on air. Acceptance is what refuses
 * to put an unavailable value on air, not this write.
 */
export interface BroadcastGraphicsSetInputPayload {
	graphicId: string;
	inputKey: string;
	value: GraphicInputValue;
}

export type BroadcastGraphicsCommandPayload
	= | BroadcastGraphicsPlayoutPayload
		| BroadcastGraphicsUpdatePayload
		| BroadcastGraphicsSetInputPayload;

/** One command as the reducer reads it: what kind of intent, and its content. */
export type BroadcastGraphicsCommandInput
	= | { type: 'Take' | 'Out'; payload: BroadcastGraphicsPlayoutPayload }
		| { type: 'Update Graphic'; payload: BroadcastGraphicsUpdatePayload }
		| { type: 'Set Input'; payload: BroadcastGraphicsSetInputPayload };

/**
 * What the reducer needs to know about the Broadcast Graphic a command addresses.
 *
 * Its declared Graphic Inputs, because acceptance has to know each input's type,
 * constraints, requiredness, and On-air Update Policy; and how long its lifecycle
 * phases last, because two of acceptance's decisions are about a schedule. Neither
 * belongs in live state: both are authored configuration that an author may change
 * under a running show, so a copy in the session would be a copy that can go stale.
 */
export interface BroadcastGraphicsReductionContext {
	inputs: readonly GraphicInputDeclaration[];
	/**
	 * The authoritative instant this command was accepted at.
	 *
	 * Supplied by the caller rather than read from a clock here, because this
	 * reducer runs on the server and in every client and only one of them is
	 * authoritative. The server passes its own clock when it accepts the command; a
	 * client replaying the same command onto a snapshot passes what it was given.
	 */
	acceptedAt: number;
	/**
	 * How long the addressed Broadcast Graphic's finite lifecycle phases last.
	 *
	 * Acceptance needs them for the two questions only the authoritative side can
	 * answer: whether the phase this intent interrupts is still running, and when a
	 * coalesced update is scheduled to begin. Both must be decided once, in the
	 * authoritative order, rather than by each output against its own clock.
	 *
	 * Still supplied rather than looked up — they are authored Screen configuration
	 * that this module deliberately does not read, and an author may change them under a
	 * running show. Note that reading them here does *not* freeze a phase already on
	 * program: every reader measures against the durations it currently holds, so an
	 * author who shortens an entrance mid-entrance completes it early on every output.
	 * These are used for the two decisions only acceptance can make, not to pin a
	 * schedule. Omitted means every phase is immediate, which is the answer a caller with
	 * no composition in hand should get.
	 */
	durations?: BroadcastGraphicPhaseDurations;
}

export function createInitialBroadcastGraphicsLiveState(): BroadcastGraphicsLiveState {
	return { playout: {}, inputs: {} };
}

/** The finite duration of each lifecycle phase, in milliseconds. Absent lasts zero. */
export type BroadcastGraphicPhaseDurations = Partial<Record<GraphicAnimationPhase, number>>;

function durationOf(durations: BroadcastGraphicPhaseDurations | undefined, phase: GraphicAnimationPhase): number {
	return Math.max(0, durations?.[phase] ?? 0);
}

/**
 * Where one Broadcast Graphic is on its enter/exit axis at `now`, or null once that
 * axis is settled.
 *
 * One function, used by the Graphic Playout State, the phase projection, and
 * acceptance, so all three can never disagree about whether a phase is still
 * running.
 *
 * ## The clock a reader does not own
 *
 * Both branches are bounded in magnitude, not only in sign. An effective start time
 * is stamped with the authoritative clock at acceptance, so it is never genuinely in
 * the reader's future — and a reader whose clock lags the authoritative one by more
 * than a phase lasts would otherwise sit inside that phase for the whole of the
 * skew. For an exit that is the worst operator-visible failure this module can
 * produce: an Out'd Broadcast Graphic that never leaves program on that output,
 * because a graphic leaves the frame when its exit completes. Phases last at most
 * twenty seconds and an un-synchronised browser clock is routinely minutes out, so
 * the bound is not a theoretical nicety.
 *
 * Beyond the bound the phase is reported settled. That direction is deliberate: the
 * failure becomes "this output reached the target immediately" rather than "this
 * output never reaches it", and only the first is something an operator can work
 * with. Outputs still derive `now` from a server offset so the bound is not reached
 * in the first place; this is what holds when one of them does not.
 */
function enterExitFlight(
	playout: BroadcastGraphicPlayout,
	timing: BroadcastGraphicPhaseTiming,
): { phase: GraphicAnimationPhase; elapsed: number } | null {
	if (playout.reversalCompletesAt !== undefined) {
		// A reversal plays the interrupted phase backwards, so the phase it projects is
		// the opposite of the one this intent would otherwise begin.
		const phase: GraphicAnimationPhase = playout.onAir ? 'exit' : 'enter';
		const remaining = playout.reversalCompletesAt - timing.now;
		if (remaining <= 0 || remaining > durationOf(timing.durations, phase))
			return null;
		return { phase, elapsed: remaining };
	}

	// Cut reaches its target immediately, so there is no phase to be inside of.
	if (playout.cut)
		return null;

	const phase: GraphicAnimationPhase = playout.onAir ? 'enter' : 'exit';
	const duration = durationOf(timing.durations, phase);
	if (duration <= 0)
		return null;

	const elapsed = timing.now - playout.effectiveStartedAt;
	if (elapsed >= duration || elapsed <= -duration)
		return null;

	return { phase, elapsed: Math.max(0, elapsed) };
}

/**
 * When this Broadcast Graphic's enter phase is scheduled to have completed.
 *
 * The instant on-screen cycling may begin from, and the instant an update accepted
 * during enter is deferred to. Cut and a reversal each reach the settled state on
 * their own schedule, so each supplies its own answer rather than being bent into
 * the enter duration.
 */
function enterCompletesAt(
	playout: BroadcastGraphicPlayout,
	durations: BroadcastGraphicPhaseDurations | undefined,
): number {
	if (playout.reversalCompletesAt !== undefined)
		return playout.reversalCompletesAt;
	if (playout.cut)
		return playout.effectiveStartedAt;
	return playout.effectiveStartedAt + durationOf(durations, 'enter');
}

/** The active update transition, walked forward to `now`. */
interface BroadcastGraphicUpdateFlight {
	/** The authoritative effective start time of the transition now in play. */
	startedAt: number;
	from: GraphicInputValues;
	to: GraphicInputValues;
	/** Whether one further rendering is still pending behind this transition. */
	pending: boolean;
}

/**
 * The update chain, normalised against `now`.
 *
 * The one place the coalescing rules are interpreted, shared by acceptance and by
 * every reader. It walks forward only: a completed transition hands over to the
 * rendering pending behind it, and once nothing is left it returns null — so a chain
 * read long after it was written reports no update rather than an ancient one, with
 * nothing to detect and nothing to clear.
 */
function rollUpdateChain(
	playout: BroadcastGraphicPlayout | undefined,
	inputs: BroadcastGraphicInputsState,
	updateMs: number,
	now: number,
	/** How long the entrance an update may have been deferred behind lasts. */
	enterMs = 0,
): BroadcastGraphicUpdateFlight | null {
	if (!playout || playout.updateStartedAt === undefined || updateMs <= 0)
		return null;

	// The same bound the enter/exit axis carries, in the one direction this field can be
	// read wrong. An update is deferred by at most an entrance, so a start time further
	// ahead than that means the reader's clock is behind the authoritative one — and
	// without the bound such a reader sits at `now < startedAt` for the whole of the skew
	// and renders the *old* rendering indefinitely. That is the same
	// bounded-in-sign-unbounded-in-magnitude failure this ticket exists to remove, so it
	// does not get to reappear in the field the ticket added.
	if (playout.updateStartedAt - now > Math.max(0, enterMs) + updateMs)
		return null;

	let startedAt = playout.updateStartedAt;
	let from = inputs.updateFrom ?? {};
	let pending = inputs.pendingUpdateFrom;

	// At most one hand-over, because at most one rendering is ever pending.
	if (now >= startedAt + updateMs) {
		if (pending === undefined)
			return null;
		startedAt += updateMs;
		from = pending;
		pending = undefined;
		if (now >= startedAt + updateMs)
			return null;
	}

	return { startedAt, from, to: pending ?? inputs.accepted, pending: pending !== undefined };
}

/** When the whole update chain is scheduled to have finished, or null when there is none. */
function updateChainEndsAt(
	playout: BroadcastGraphicPlayout,
	inputs: BroadcastGraphicInputsState,
	updateMs: number,
): number | null {
	if (playout.updateStartedAt === undefined || updateMs <= 0)
		return null;
	return playout.updateStartedAt + (updateMs * (inputs.pendingUpdateFrom === undefined ? 1 : 2));
}

/**
 * The playout record one accepted intent produces, or the current one unchanged.
 *
 * Whether to write is asymmetric, and deliberately so. A repeat of an intent
 * already reached must not refresh the effective start time, or a duplicate
 * delivery would restart a phase that is already running on program. But Cut has
 * to be able to settle a phase that *is* running, even though it reaches the same
 * on-air target — so Cut arriving over a non-Cut intent is a real change.
 *
 * The six cases, which the tests enumerate:
 *
 * - repeat plain Take while on air — no-op, no phase restart
 * - Cut Take while entering — writes, settling the entrance immediately
 * - plain Take after Cut Take — no-op; the graphic is already settled on air, and
 *   writing would send a settled graphic back to `entering` and replay its
 *   entrance on program
 * - plain Out after Cut Out — no-op; writing would make an already-off graphic
 *   `exiting`, putting it back on program to play an exit it already skipped
 * - Cut Out while exiting — writes, settling the exit immediately
 * - Cut Take after Cut Take — no-op, because the Cut is already reflected
 *
 * ## Interrupting a phase that is still in flight
 *
 * An intent that arrives while the opposite phase is still running does not begin
 * its own phase from the beginning — it takes over the one in flight, from exactly
 * where that phase had reached. There are only two ways to take over, and which one
 * applies falls out of comparing the phase in flight with the phase this intent
 * would otherwise start:
 *
 * - **Reverse**, when they differ. Out during enter plays the entrance backwards
 *   from the frame currently on program, at the speed it arrived, so it clears in
 *   the time it had taken to get that far — a graphic barely on screen leaves almost
 *   at once, and one nearly settled takes nearly the whole entrance to go. Take
 *   during exit is the same statement mirrored. Reversing the recipe that is already
 *   running is what makes the reversal *smooth*: no other recipe could be started
 *   mid-travel without a jump, because a fade and a slide have nothing in common to
 *   interpolate between.
 * - **Resume**, when they are the same phase. That is an operator changing their
 *   mind twice: Out during enter, then Take again. The reversal is already playing
 *   the enter backwards, so the second Take simply continues the enter *forwards*
 *   from the frame on screen, which is expressed by back-dating the effective start
 *   time so that the elapsed time is what is already rendered. Nothing about the
 *   record says it is a resumption, and nothing needs to.
 *
 * A completed phase is not interrupted, a Cut phase was never in flight, and a Cut
 * intent settles immediately — so all three take over nothing.
 */
function nextPlayout(
	current: BroadcastGraphicPlayout | undefined,
	intent: { onAir: boolean; cut: boolean },
	acceptedAt: number,
	durations: BroadcastGraphicPhaseDurations | undefined,
): BroadcastGraphicPlayout {
	if (current && current.onAir === intent.onAir && !(intent.cut && !current.cut))
		return current;

	const settled: BroadcastGraphicPlayout = { onAir: intent.onAir, effectiveStartedAt: acceptedAt, cut: intent.cut };
	if (!current || intent.cut)
		return settled;

	// Nothing rendered yet is nothing to take over: an intent that arrives in the same
	// millisecond as the phase it would interrupt starts its own phase cleanly, rather
	// than recording a zero-length reversal for a reader to unwind.
	const flight = enterExitFlight(current, { now: acceptedAt, durations });
	if (!flight || flight.elapsed <= 0)
		return settled;

	if (flight.phase === (intent.onAir ? 'enter' : 'exit'))
		return { ...settled, effectiveStartedAt: acceptedAt - flight.elapsed };

	return { ...settled, reversalCompletesAt: acceptedAt + flight.elapsed };
}

/**
 * The same accepted intent with no update phase in flight.
 *
 * Rebuilt rather than spread-and-deleted so the durable record genuinely loses the
 * field: an intent that shows its new rendering immediately must leave nothing for a
 * reader to find and animate later.
 */
function withoutUpdatePhase(playout: BroadcastGraphicPlayout): BroadcastGraphicPlayout {
	return {
		onAir: playout.onAir,
		effectiveStartedAt: playout.effectiveStartedAt,
		cut: playout.cut,
		...(playout.reversalCompletesAt === undefined ? {} : { reversalCompletesAt: playout.reversalCompletesAt }),
	};
}

function withInputs(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	inputs: BroadcastGraphicInputsState,
): BroadcastGraphicsLiveState {
	return { ...state, inputs: { ...state.inputs, [graphicId]: inputs } };
}

/**
 * Take: state that this Broadcast Graphic is the operator's latest desired on-air
 * intent, and accept the values it should enter with.
 *
 * A graphic already on air only has its intent restated. Accepting the working
 * set again would make a second press a backdoor Update Graphic, and partial edits
 * would reach program without anyone confirming them — so Take accepts only on the
 * way on air, which is exactly the rule that editing an off graphic changes the
 * working values its *next* Take accepts.
 */
function reduceTake(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsPlayoutPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const playout = {
		...state.playout,
		[payload.graphicId]: nextPlayout(
			state.playout[payload.graphicId],
			{ onAir: true, cut: payload.cut === true },
			context.acceptedAt,
			context.durations,
		),
	};
	if (state.playout[payload.graphicId]?.onAir)
		return { ...state, playout };

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const blocked = unavailableRequiredGraphicInputs(inputs, context.inputs);
	if (blocked.length > 0) {
		throw new BroadcastGraphicsCommandRejection(
			'required-input-unavailable',
			`${blocked.map(declaration => declaration.label).join(', ')} must have a value before this Broadcast Graphic can go on air`,
			blocked.map(declaration => declaration.key),
		);
	}

	return {
		...withInputs(state, payload.graphicId, {
			...inputs,
			accepted: acceptGraphicInputValues(inputs, context.inputs),
			acceptedRevision: inputs.acceptedRevision + 1,
		}),
		playout,
	};
}

/**
 * Update Graphic: one atomic acceptance of the complete staged set.
 *
 * A required Graphic Input that has become unavailable does not block it. The
 * graphic is already on air, and the settled rule is that its last accepted value
 * stays visible until the operator updates or overrides it — which acceptance
 * achieves by passing over the unavailable value rather than by refusing.
 *
 * ## Accepting the values and scheduling the animation are two different things
 *
 * The values are accepted here, unconditionally and at once — that is what makes
 * "interrupting an update never rolls back its accepted values" true by
 * construction, because nothing in this module ever writes an older set over a
 * newer one. What the update *schedule* then does with them is a separate decision,
 * and there are only four outcomes:
 *
 * - **Cut Update** shows the new rendering immediately, so it schedules nothing.
 *   During enter that is exactly the required behaviour — the new rendering is swapped
 *   into whatever animated state the entrance has reached, the enter schedule is
 *   untouched because this command never writes the enter's own fields, and no
 *   post-enter update is left pending for those values.
 * - **Nothing changed** schedules nothing either: an update recipe runs when rendered
 *   content changes, and it did not.
 * - **No update in flight** schedules one, deferred to enter's completion if the
 *   graphic is still entering. That deferral is what coalesces every acceptance
 *   during enter into one update afterwards, and it is decided once here rather than
 *   by each output.
 * - **An update in flight** leaves that update's schedule alone and makes this
 *   acceptance the single pending rendering behind it. A further acceptance replaces
 *   the pending rendering's target rather than appending to it, which is why the
 *   chain can hold at most two transitions and never becomes a queue.
 */
function reduceUpdateGraphic(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsUpdatePayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const playout = state.playout[payload.graphicId];
	if (!playout?.onAir) {
		throw new BroadcastGraphicsCommandRejection(
			'update-unavailable',
			'Update Graphic is available only while a Broadcast Graphic is on air',
		);
	}

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	if (payload.basedOnAcceptedRevision !== inputs.acceptedRevision) {
		throw new BroadcastGraphicsCommandRejection(
			'stale-input-acceptance',
			'Another operator has already accepted a newer Graphic Input set for this Broadcast Graphic',
		);
	}

	const accepted = acceptGraphicInputValues(inputs, context.inputs);
	const acceptedRevision = inputs.acceptedRevision + 1;
	const updateMs = durationOf(context.durations, 'update');

	if (payload.cut === true || updateMs <= 0 || sameGraphicInputValues(inputs.accepted, accepted)) {
		return {
			...withInputs(state, payload.graphicId, { working: inputs.working, accepted, acceptedRevision }),
			playout: { ...state.playout, [payload.graphicId]: withoutUpdatePhase(playout) },
		};
	}

	const flight = rollUpdateChain(playout, inputs, updateMs, context.acceptedAt, durationOf(context.durations, 'enter'));
	const scheduled = flight
		? context.acceptedAt >= flight.startedAt
			// An update is actually running: this acceptance becomes the one pending
			// rendering behind it, and the running transition is left to finish.
			? { startedAt: flight.startedAt, updateFrom: flight.from, pendingUpdateFrom: flight.to }
			// An update is scheduled but has not begun — every acceptance during an
			// entrance lands here — so it is absorbed into that one update rather than
			// queued behind it. This is what makes "coalesce into one update after enter
			// completes" one update however many acceptances arrive during the entrance.
			: { startedAt: flight.startedAt, updateFrom: flight.from, pendingUpdateFrom: undefined }
		: {
				startedAt: Math.max(context.acceptedAt, enterCompletesAt(playout, context.durations)),
				updateFrom: inputs.accepted,
				pendingUpdateFrom: undefined,
			};

	return {
		...withInputs(state, payload.graphicId, {
			working: inputs.working,
			accepted,
			acceptedRevision,
			updateFrom: scheduled.updateFrom,
			...(scheduled.pendingUpdateFrom === undefined ? {} : { pendingUpdateFrom: scheduled.pendingUpdateFrom }),
		}),
		playout: {
			...state.playout,
			[payload.graphicId]: { ...playout, updateStartedAt: scheduled.startedAt },
		},
	};
}

/**
 * Set Input: change one working value, and — under a live On-air Update Policy on
 * an on-air graphic — accept that one field with it.
 *
 * A live acceptance deliberately leaves `acceptedRevision` alone. It accepts its
 * own field and nothing else, so counting it would make ordinary live edits
 * invalidate a staged Update Graphic another operator is preparing on the same
 * graphic's other inputs.
 *
 * It does collapse an update phase that is still running, and that is not
 * housekeeping. An update cross-transitions a *pair* of renderings, and its target is
 * the accepted set — so writing one field into `accepted` while the transition is in
 * flight would change what the running transition is travelling towards, and the
 * content it is halfway through revealing would cut. Live means applied immediately,
 * so applying it immediately is right and the animation is what gives way: the
 * transition is abandoned, the new rendering is what is on screen, and there is no
 * half-crossed state for anyone to read.
 */
function reduceSetInput(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsSetInputPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	if (!isDeclaredGraphicInput(context.inputs, payload.inputKey)) {
		throw new BroadcastGraphicsCommandRejection(
			'unknown-input',
			`This Broadcast Graphic declares no Graphic Input named ${payload.inputKey}`,
			[payload.inputKey],
		);
	}

	const declaration = findGraphicInputDeclaration(context.inputs, payload.inputKey)!;
	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const acceptsImmediately = declaration.updatePolicy === 'live'
		&& state.playout[payload.graphicId]?.onAir === true
		&& graphicInputAvailability(declaration, payload.value).available;

	if (!acceptsImmediately) {
		return withInputs(state, payload.graphicId, {
			...inputs,
			working: { ...inputs.working, [payload.inputKey]: payload.value },
		});
	}

	const playout = state.playout[payload.graphicId]!;
	return {
		...withInputs(state, payload.graphicId, {
			working: { ...inputs.working, [payload.inputKey]: payload.value },
			accepted: { ...inputs.accepted, [payload.inputKey]: payload.value },
			acceptedRevision: inputs.acceptedRevision,
		}),
		playout: { ...state.playout, [payload.graphicId]: withoutUpdatePhase(playout) },
	};
}

/**
 * Reduce one accepted command onto the Live Session's state.
 *
 * Playout intents are assignments, which is what makes them idempotent by
 * construction. Graphic Input acceptance is not: accepting a staged set twice is a
 * genuine double-apply, so the Command Receipt that recognises a repeated delivery
 * and the acceptance revision that refuses a stale one are both load-bearing here
 * in a way they never were for Take and Out alone.
 */
export function applyBroadcastGraphicsCommand(
	state: BroadcastGraphicsLiveState,
	command: BroadcastGraphicsCommandInput,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const normalized: BroadcastGraphicsLiveState = { playout: state.playout ?? {}, inputs: state.inputs ?? {} };

	switch (command.type) {
		case 'Take':
			return reduceTake(normalized, command.payload, context);
		case 'Out':
			return {
				...normalized,
				playout: {
					...normalized.playout,
					[command.payload.graphicId]: nextPlayout(
						normalized.playout[command.payload.graphicId],
						{ onAir: false, cut: command.payload.cut === true },
						context.acceptedAt,
						context.durations,
					),
				},
			};
		case 'Update Graphic':
			return reduceUpdateGraphic(normalized, command.payload, context);
		case 'Set Input':
			return reduceSetInput(normalized, command.payload, context);
	}
}

/** The Graphic Input state a fresh placed Broadcast Graphic starts from. */
export { createInitialBroadcastGraphicInputsState };

/**
 * Everything one placed Broadcast Graphic's schedule is read against, derived from
 * its own authored Graphic Animation.
 *
 * The one derivation, used by the server that stamps an authoritative effective start
 * time and by every output that projects from it, so no reader can disagree with the
 * writer about how long a phase lasts. `now` stays the caller's, because only the
 * caller knows which clock it is entitled to read.
 */
export function broadcastGraphicPhaseTiming(
	graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
	now: number,
): BroadcastGraphicPhaseTiming {
	return {
		now,
		durations: broadcastGraphicPhaseDurations(graphic),
		onScreen: broadcastGraphicHasPhaseAnimation(graphic, 'on-screen'),
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
	durations?: BroadcastGraphicPhaseDurations;
	/**
	 * Whether this Broadcast Graphic authored any on-screen Graphic Animation Recipe.
	 *
	 * A flag rather than a duration, because an on-screen recipe has no phase length
	 * by design: an indefinite one never finishes, and even a finite one must not
	 * prevent the Graphic Playout State from being on-air. Each recipe bounds its own
	 * repetition, so the projection can hand out an ever-growing elapsed time and let
	 * every owner decide for itself when it has stopped cycling.
	 */
	onScreen?: boolean;
}

/**
 * The operator-visible lifecycle status of one placed Broadcast Graphic.
 *
 * Without timing this reports only the settled states — off and on-air — which is
 * what a caller that does not care about animation wants and what recovery
 * resolves to by definition. With timing it additionally reports entering, exiting,
 * and updating, each derived from one authoritative effective start time and bounded
 * by the phase's own duration, so a graphic whose phase has elapsed is settled rather
 * than mid-flight however long ago that phase started.
 *
 * The enter/exit axis is answered first and wins: a graphic on its way off air is
 * exiting even if an update was still pending when Out was accepted, which is the
 * same statement as exit discarding a pending visual update. Waiting arrives with the
 * Graphic Channel handoff that produces it.
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
	if (!timing)
		return settled;

	// Which way the graphic is travelling is the intent's, not the projected phase's: a
	// reversal renders the phase it is unwinding, so a graphic reversing its entrance
	// renders `enter` while being, to an operator, unambiguously on its way off air.
	if (enterExitFlight(playout, timing))
		return playout.onAir ? 'entering' : 'exiting';

	if (!playout.onAir)
		return 'off';

	const update = rollUpdateChain(
		playout,
		broadcastGraphicInputsState(state, graphicId),
		durationOf(timing.durations, 'update'),
		timing.now,
		durationOf(timing.durations, 'enter'),
	);
	// A deferred update has not begun, so the graphic is still on air rather than
	// updating — and an indefinite on-screen recipe never stops it being on air either.
	return update && timing.now >= update.startedAt ? 'updating' : 'on-air';
}

/**
 * The lifecycle phase and elapsed time one Broadcast Graphic's Screen Output
 * should render, or null while it is settled at its Graphic Resting State or off.
 *
 * This is the seam a Screen Output and the Program monitor project animation
 * through: one phase and one elapsed time, both derived, so a late-loading or
 * reconnected output catches up to the current authoritative phase instead of
 * replaying it from the beginning.
 *
 * On-screen cycling is projected here too, and it is the one phase whose elapsed
 * time grows without bound: it begins when the entrance completes — or when the last
 * update completes, because an update interrupts cycling and cycling then restarts
 * from its beginning — and never gates the Graphic Playout State.
 */
export function broadcastGraphicPhaseProjection(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	/**
	 * Omitted means there is nothing to animate, which is the honest answer for a caller
	 * with no instant it trusts: a reader that has not established the authoritative
	 * clock cannot say which phase anything is in, and guessing on its own clock is the
	 * one thing it must not do.
	 */
	timing?: BroadcastGraphicPhaseTiming,
): { phase: GraphicAnimationPhase; elapsed: number } | null {
	const playout = state.playout[graphicId];
	if (!playout || !timing)
		return null;

	const flight = enterExitFlight(playout, timing);
	if (flight)
		return flight;

	if (!playout.onAir)
		return null;

	const inputs = broadcastGraphicInputsState(state, graphicId);
	const updateMs = durationOf(timing.durations, 'update');
	const update = rollUpdateChain(playout, inputs, updateMs, timing.now, durationOf(timing.durations, 'enter'));
	if (update && timing.now >= update.startedAt)
		return { phase: 'update', elapsed: timing.now - update.startedAt };

	if (!timing.onScreen)
		return null;

	const cyclesFrom = Math.max(
		enterCompletesAt(playout, timing.durations),
		updateChainEndsAt(playout, inputs, updateMs) ?? Number.NEGATIVE_INFINITY,
	);
	return timing.now >= cyclesFrom ? { phase: 'on-screen', elapsed: timing.now - cyclesFrom } : null;
}

/**
 * The rendering, or pair of renderings, one Broadcast Graphic's outputs should draw.
 *
 * Separate from the phase projection because they answer different questions — where
 * the motion is, and which values the motion is applied to — and only an update phase
 * has two answers to the second one. `outgoing` is the rendering the update
 * cross-transitions away from; when it is absent there is one rendering and nothing
 * to cross.
 *
 * `current` is not always the accepted set. While an acceptance is coalescing behind
 * an entrance, program is still showing the rendering the graphic entered with, and
 * showing the accepted values early is exactly the thing coalescing exists to
 * prevent. Live Control still reports the accepted set as accepted: the values were
 * accepted the moment the command was, and nothing here rolls them back.
 */
export function broadcastGraphicRenderedInputs(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	declarations: readonly GraphicInputDeclaration[],
	timing?: BroadcastGraphicPhaseTiming,
): { current: GraphicInputValues; outgoing?: GraphicInputValues } {
	const inputs = broadcastGraphicInputsState(state, graphicId);
	const settled = { current: resolveGraphicInputValues(inputs.accepted, declarations) };
	if (!timing)
		return settled;

	const update = rollUpdateChain(
		state.playout[graphicId],
		inputs,
		durationOf(timing.durations, 'update'),
		timing.now,
		durationOf(timing.durations, 'enter'),
	);
	if (!update)
		return settled;

	if (timing.now < update.startedAt)
		return { current: resolveGraphicInputValues(update.from, declarations) };

	return {
		current: resolveGraphicInputValues(update.to, declarations),
		outgoing: resolveGraphicInputValues(update.from, declarations),
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
	/**
	 * One timing for the whole stack, or a resolver when each Broadcast Graphic has
	 * its own phase durations — which is always true of a real Screen, because
	 * durations come from each graphic's own authored recipes.
	 */
	timing?: BroadcastGraphicPhaseTiming | ((graphic: Pick<BroadcastGraphicConfig, 'id'>) => BroadcastGraphicPhaseTiming | undefined),
): string[] {
	return graphics
		.filter((graphic) => {
			const status = broadcastGraphicPlayoutState(
				state,
				graphic.id,
				typeof timing === 'function' ? timing(graphic) : timing,
			);
			// A waiting graphic is absent from every program output; off is off.
			return status !== 'off' && status !== 'waiting';
		})
		.map(graphic => graphic.id);
}
