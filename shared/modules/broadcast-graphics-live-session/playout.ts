import type { GraphicSourceSelectionsState } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicChannelConfig,
	GraphicChannelHandoffPolicy,
	GraphicInputBinding,
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicPlayoutState,
	GraphicSourceSelectionDeclaration,
} from '~~/shared/types/graphics';
import type {
	BroadcastGraphicInputsState,
	GraphicInputValues,
	NormalizedBroadcastGraphicInputsState,
} from './inputs';
import {
	broadcastGraphicHasPhaseAnimation,
	broadcastGraphicPhaseDurations,
	findGraphicInputDeclaration,
	graphicChannelHandoffPolicy,
	graphicInputAvailability,
	isOperatorSelectedGraphicSource,
} from '~~/shared/modules/graphics';
import {
	acceptGraphicInputValues,
	broadcastGraphicInputsState,
	broadcastGraphicSourceSelections,
	createInitialBroadcastGraphicInputsState,
	effectiveGraphicInputValue,
	isDeclaredGraphicInput,
	resolveGraphicInputValues,
	sameGraphicInputValue,
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
 *
 * ## Why Event Data reaches reduction as a function
 *
 * Graphic Input Bindings resolve against Event Data, which is neither live state
 * nor something a pure reducer can read. It arrives in the reduction context as a
 * resolver over Graphic Source Selections rather than as a fixed map, because
 * Select Source changes the very selections the bindings resolve against: the
 * command's own effect has to be visible to the resolution its acceptance depends
 * on. Authored declarations arrive the same way, and for the same reason they
 * always have — an author may change them under a running show, so live state must
 * never hold a copy.
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
	/** Working, override, and accepted Graphic Input values, per placed Broadcast Graphic. */
	inputs: Record<string, BroadcastGraphicInputsState>;
	/**
	 * Which entity each operator-selected Graphic Source Selection names, per placed
	 * Broadcast Graphic. Only the selection is stored — never the entity, which
	 * follows Event Data.
	 *
	 * Optional for the same reason `overrides` is: a session persisted before Graphic
	 * Source Selections existed carries no such key, and every read normalizes.
	 */
	sources?: Record<string, GraphicSourceSelectionsState>;
}

/** The actions a Broadcast Graphics Live Session accepts. */
export const BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES = [
	'Take',
	'Out',
	'Update Graphic',
	'Set Input',
	'Set Override',
	'Select Source',
	'Resolve Bindings',
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
	/**
	 * The value this edit believes it replaces: its Field Ownership claim.
	 *
	 * Field Ownership is the set of fields one action may write, derived from the
	 * change it predicts — and a Set Input predicts exactly one Graphic Input going
	 * from one value to another. Stating the value it started from is what makes
	 * two operators on one Broadcast Graphic safe without locking either out: an
	 * edit whose claim still holds is applied, and one whose claim has been
	 * overtaken is refused so the operator can see what landed instead rather than
	 * silently erasing a colleague's correction seconds before it goes on air.
	 *
	 * Wrapped in an object rather than left as a bare optional value because `null`
	 * is itself a legitimate Graphic Input value: the wrapper distinguishes
	 * "I claim the value was empty" from "I claim nothing". An edit that claims
	 * nothing is not making a Field Ownership claim and is applied unconditionally.
	 */
	basedOn?: { value: GraphicInputValue };
}

/**
 * One Graphic Input Override set or cleared.
 *
 * `null` clears it. An override exists to mask a binding with an operator's own
 * value, so masking with "no value" would mean nothing — clearing is how an
 * operator stops masking, after which the current bound value resumes.
 */
export interface BroadcastGraphicsSetOverridePayload {
	graphicId: string;
	inputKey: string;
	value: GraphicInputValue;
	/**
	 * The value this override believes it replaces: its Field Ownership claim, in
	 * exactly the shape a working edit's is. An override is field-scoped for the same
	 * reason and is refused on the same terms.
	 */
	basedOn?: { value: GraphicInputValue };
}

/**
 * One Graphic Source Selection pointed at an entity, or cleared with `null`.
 *
 * Only the entity id is accepted. Storing the entity itself would make live state
 * a stale copy of Event Data, and every binding through this selection re-resolves
 * from current Event Data instead.
 */
export interface BroadcastGraphicsSelectSourcePayload {
	graphicId: string;
	sourceKey: string;
	selectionId: number | null;
}

/**
 * One re-resolution of a Broadcast Graphic's Graphic Input Bindings.
 *
 * Sent when Event Data a binding reads has changed, so a live On-air Update Policy
 * input can reach air without an operator touching anything. It carries no value:
 * the server re-resolves from Event Data itself, so this is a notification that the
 * facts moved rather than a client's claim about what they moved to. Applying it
 * twice accepts the same resolved value twice, which is why redelivery — including
 * from a second Live Control watching the same change — converges.
 */
export interface BroadcastGraphicsResolveBindingsPayload {
	graphicId: string;
}

export type BroadcastGraphicsCommandPayload
	= | BroadcastGraphicsPlayoutPayload
		| BroadcastGraphicsUpdatePayload
		| BroadcastGraphicsSetInputPayload
		| BroadcastGraphicsSetOverridePayload
		| BroadcastGraphicsSelectSourcePayload
		| BroadcastGraphicsResolveBindingsPayload;

/** One command as the reducer reads it: what kind of intent, and its content. */
export type BroadcastGraphicsCommandInput
	= | { type: 'Take' | 'Out'; payload: BroadcastGraphicsPlayoutPayload }
		| { type: 'Update Graphic'; payload: BroadcastGraphicsUpdatePayload }
		| { type: 'Set Input'; payload: BroadcastGraphicsSetInputPayload }
		| { type: 'Set Override'; payload: BroadcastGraphicsSetOverridePayload }
		| { type: 'Select Source'; payload: BroadcastGraphicsSelectSourcePayload }
		| { type: 'Resolve Bindings'; payload: BroadcastGraphicsResolveBindingsPayload };

/**
 * What the reducer needs to know about the Broadcast Graphic a command addresses.
 *
 * Its declared Graphic Inputs, because acceptance has to know each input's type,
 * constraints, requiredness, and On-air Update Policy; its Graphic Source Selection
 * declarations and Graphic Input Bindings, plus a way to resolve those bindings
 * against current Event Data; and how long its lifecycle phases last, because two of
 * acceptance's decisions are about a schedule.
 *
 * None of it belongs in live state. The declarations and durations are authored
 * configuration an author may change under a running show, so a copy in the session
 * would be a copy that can go stale; and Event Data belongs to the Event rather than
 * to this session at all.
 */
export interface BroadcastGraphicsReductionContext {
	inputs: readonly GraphicInputDeclaration[];
	sources?: readonly GraphicSourceSelectionDeclaration[];
	bindings?: readonly GraphicInputBinding[];
	/**
	 * The latest bound value of each bound Graphic Input, for a given set of Graphic
	 * Source Selections. Absent resolves nothing, which is what a caller with no
	 * Event Data to hand — and every Broadcast Graphic that declares no binding —
	 * correctly means.
	 */
	resolveBindings?: (selections: GraphicSourceSelectionsState) => Record<string, GraphicInputValue>;
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
	/**
	 * The Graphic Channel the addressed Broadcast Graphic belongs to, if it belongs
	 * to one.
	 *
	 * A Take is the one playout action that writes more than one graphic's field:
	 * taking a channel member replaces whichever member the channel currently holds.
	 * That replacement needs the channel's other members and how long *their* phases
	 * last, which is authored Screen configuration exactly as this graphic's own
	 * durations are — so it arrives the same way, and for the same reason.
	 *
	 * Absent is a Broadcast Graphic in no Graphic Channel, which runs concurrently
	 * with everything else and replaces nothing.
	 */
	channel?: BroadcastGraphicChannelContext;
}

/** One placed Broadcast Graphic in a Graphic Channel, and how long its phases last. */
export interface BroadcastGraphicChannelMember {
	graphicId: string;
	durations?: BroadcastGraphicPhaseDurations;
}

/**
 * What playout needs to know about one Graphic Channel.
 *
 * The channel's authored policy and every Broadcast Graphic the Screen places in
 * it, including the graphic being addressed — which is skipped by id rather than
 * excluded when the context is built, so one context describes the channel rather
 * than one graphic's view of it and can be shared by every member.
 *
 * Which member the channel currently holds is deliberately not here: it is the
 * member whose latest accepted intent is on air, so it is already in live state and
 * a second copy could only disagree with it.
 */
export interface BroadcastGraphicChannelContext {
	handoff: GraphicChannelHandoffPolicy;
	members: readonly BroadcastGraphicChannelMember[];
}

export function createInitialBroadcastGraphicsLiveState(): BroadcastGraphicsLiveState {
	return { playout: {}, inputs: {}, sources: {} };
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
 * When the phase this Broadcast Graphic's latest accepted intent began is scheduled
 * to have completed.
 *
 * For an on-air intent that is the instant on-screen cycling may begin from and the
 * instant an update accepted during enter is deferred to; for an off-air one it is
 * the instant the graphic leaves program, which is what an Out then in Graphic
 * Channel handoff schedules the incoming enter at. Cut and a reversal each reach the
 * settled state on their own schedule, so each supplies its own answer rather than
 * being bent into a phase duration.
 */
function phaseSettlesAt(
	playout: BroadcastGraphicPlayout,
	durations: BroadcastGraphicPhaseDurations | undefined,
): number {
	if (playout.reversalCompletesAt !== undefined)
		return playout.reversalCompletesAt;
	if (playout.cut)
		return playout.effectiveStartedAt;
	return playout.effectiveStartedAt + durationOf(durations, playout.onAir ? 'enter' : 'exit');
}

/**
 * The record a Broadcast Graphic removed from program without running an exit phase
 * carries.
 *
 * Two things reach it. A Cut channel replacement, which bypasses the Graphic Channel
 * Handoff Policy and switches immediately; and a Take or Out that cancels a member
 * still waiting, which has no exit to run because it never reached program at all.
 * Both are the same durable fact — this graphic is off, it settled at once, and there
 * is nothing for a reader to animate — which is exactly what `cut` records.
 */
function cutOff(acceptedAt: number): BroadcastGraphicPlayout {
	return { onAir: false, effectiveStartedAt: acceptedAt, cut: true };
}

/**
 * Whether a Graphic Channel is holding this Broadcast Graphic waiting.
 *
 * The glossary sentence, transcribed: the graphic is selected by an Out then in
 * Graphic Channel handoff but remains off every program output until the outgoing
 * graphic finishes. Both halves are read rather than stored — the selection from this
 * graphic's own accepted intent, the outgoing graphic from its channel's other
 * members — because a written-down waiting flag is a phase by another name, and this
 * module persists no phase.
 *
 * ## Why occupancy is the test rather than the deferred start time
 *
 * The handoff also back-dates nothing and forward-dates one thing: the incoming
 * graphic's effective start time is the outgoing exit's authoritative scheduled
 * completion, so `now < effectiveStartedAt` says the same thing. It is not the test
 * used here, because it has no bound. A reader whose clock lags the authoritative one
 * would sit before that instant for the whole of the skew and hold a graphic off
 * program indefinitely — the worst failure this module can produce, and the one the
 * enter/exit magnitude bound exists to prevent.
 *
 * Occupancy carries that bound for free. It is answered by each outgoing member's own
 * `enterExitFlight`, which is already bounded in both directions, so a badly skewed
 * reader concludes the channel is clear and enters the graphic at once. That is the
 * failure direction this module chooses everywhere: reaching the target immediately
 * beats never reaching it.
 *
 * Overlap is excluded before any member is looked at. Under Overlap the outgoing exit
 * and the incoming enter begin at the same logical instant, so the channel is occupied
 * for the whole of the overlap by design — reading occupancy alone would hold every
 * Overlap handoff's incoming graphic off program, which is the opposite of what
 * Overlap means.
 */
function channelHoldsWaiting(
	playout: BroadcastGraphicPlayout | undefined,
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	channel: BroadcastGraphicChannelContext | undefined,
	now: number,
): boolean {
	if (playout?.onAir !== true || channel?.handoff !== 'out-then-in')
		return false;

	return channel.members.some((member) => {
		if (member.graphicId === graphicId)
			return false;
		const other = state.playout[member.graphicId];
		return other !== undefined
			&& !other.onAir
			&& enterExitFlight(other, { now, durations: member.durations }) !== null;
	});
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
	/**
	 * When this intent's phase begins, if a Graphic Channel has deferred it past the
	 * instant the command was accepted at.
	 *
	 * Only Out then in supplies one, and it never applies to an intent that takes over
	 * a phase in flight: a graphic already on program cannot be held waiting, because
	 * waiting means absent from every output. So a reversal or a resumption keeps the
	 * schedule it computes for itself, and only a clean start is deferred.
	 */
	startsAt = acceptedAt,
): BroadcastGraphicPlayout {
	if (current && current.onAir === intent.onAir && !(intent.cut && !current.cut))
		return current;

	const settled: BroadcastGraphicPlayout = { onAir: intent.onAir, effectiveStartedAt: startsAt, cut: intent.cut };
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

	return { ...settled, effectiveStartedAt: acceptedAt, reversalCompletesAt: acceptedAt + flight.elapsed };
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
	inputs: NormalizedBroadcastGraphicInputsState,
): BroadcastGraphicsLiveState {
	return { ...state, inputs: { ...state.inputs, [graphicId]: inputs } };
}

/**
 * Store a field-scoped edit together with whatever its On-air Update Policy accepted,
 * collapsing an update phase that is still in flight if anything actually reached air.
 *
 * An update cross-transitions a *pair* of renderings towards the accepted set, so
 * writing a field into `accepted` mid-flight would change what the running transition
 * is travelling towards and cut the content it is halfway through revealing. Live
 * means applied immediately, so the animation is what gives way: the transition is
 * abandoned, the new rendering is what is on screen, and no half-crossed state is left
 * for a reader to find.
 *
 * Both field-scoped edits go through here rather than one of them, because the hazard
 * is the write to `accepted` and not which command performed it — a live-policy
 * override lands on program exactly as a live-policy working edit does.
 *
 * Nothing accepted means no rendering change and no phase to collapse.
 * `acceptLivePolicyValues` returns the very same map when it accepts nothing, which is
 * what makes identity the honest test here rather than comparing values.
 */
function withFieldScopedAcceptance(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	edited: NormalizedBroadcastGraphicInputsState,
	accepted: Record<string, GraphicInputValue>,
): BroadcastGraphicsLiveState {
	const next = withInputs(state, graphicId, { ...edited, accepted });
	const playout = state.playout[graphicId];

	if (accepted === edited.accepted || !playout)
		return next;

	return { ...next, playout: { ...next.playout, [graphicId]: withoutUpdatePhase(playout) } };
}

/** The latest bound values for one Broadcast Graphic's current Graphic Source Selections. */
function boundValuesFor(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	context: BroadcastGraphicsReductionContext,
	selections: GraphicSourceSelectionsState = broadcastGraphicSourceSelections(state, graphicId),
): Record<string, GraphicInputValue> {
	return context.resolveBindings?.(selections) ?? {};
}

/**
 * Accept one Graphic Input's effective value now, if its On-air Update Policy says
 * so and the graphic is on air.
 *
 * A live acceptance deliberately leaves `acceptedRevision` alone. It accepts its
 * own fields and nothing else, so counting it would make ordinary live edits
 * invalidate a staged Update Graphic another operator is preparing on the same
 * graphic's other inputs.
 */
/*
 * `keys` narrows this to one edited field, which is what a Set Input or Set Override
 * passes. A Select Source or Resolve Bindings deliberately passes none: more than one
 * binding may read the changed selection — including through a derived one — and
 * re-accepting every live-policy input is both cheaper than working out which, and
 * more correct, since it also picks up a live input that could not be accepted
 * earlier and now can.
 */
function acceptLivePolicyValues(
	inputs: NormalizedBroadcastGraphicInputsState,
	context: BroadcastGraphicsReductionContext,
	bound: Readonly<Record<string, GraphicInputValue>>,
	onAir: boolean,
	keys?: readonly string[],
): Record<string, GraphicInputValue> {
	if (!onAir)
		return inputs.accepted;

	let accepted = inputs.accepted;
	for (const declaration of context.inputs) {
		if (declaration.updatePolicy !== 'live')
			continue;
		if (keys && !keys.includes(declaration.key))
			continue;

		const effective = effectiveGraphicInputValue(declaration, inputs, context.bindings, bound);
		if (!graphicInputAvailability(declaration, effective.value).available)
			continue;
		if (accepted === inputs.accepted)
			accepted = { ...inputs.accepted };
		accepted[declaration.key] = effective.value;
	}

	return accepted;
}

/**
 * Refuse an edit whose Field Ownership claim no longer describes what its operator
 * was shown.
 *
 * The claim is compared against the *effective* value — override, then a resolving
 * binding, then the working value resolved against the declared default — because
 * that is the value Live Control puts in the field. An unedited unbound input
 * therefore reads as its declared default rather than as absence, which is the case a
 * second operator's first edit falls into: without it, that edit would carry no
 * comparable claim and silently overwrite the first operator's.
 *
 * A command with no claim is accepted unconditionally, which is what a caller with no
 * displayed value to speak for — a server-side replay, a test — correctly means.
 */
function requireClaimMatchesShownValue(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	inputKey: string,
	basedOn: { value: GraphicInputValue } | undefined,
	context: BroadcastGraphicsReductionContext,
): void {
	if (!basedOn)
		return;

	const declaration = findGraphicInputDeclaration(context.inputs, inputKey)!;
	const shown = effectiveGraphicInputValue(
		declaration,
		broadcastGraphicInputsState(state, graphicId),
		context.bindings,
		boundValuesFor(state, graphicId, context),
	);

	if (!sameGraphicInputValue(basedOn.value, shown.value)) {
		throw new BroadcastGraphicsCommandRejection(
			'stale-input-edit',
			`Another operator has already changed ${declaration.label} on this Broadcast Graphic`,
			[inputKey],
		);
	}
}

/**
 * The Graphic Channel handoff one Take performs: what becomes of the members it
 * replaces, and when the newcomer's own enter may begin.
 *
 * A Graphic Channel allows at most one of its Broadcast Graphics on air at a time,
 * so taking a member is the one playout action that writes another graphic's field.
 * It retains only its latest selection and never queues earlier Takes, which is why
 * this reads the channel's members rather than any stored queue: whatever each member
 * is currently doing, one command decides what all of them do next.
 *
 * Each other member falls into exactly one of three cases at the instant the command
 * is accepted:
 *
 * - **The current selection** — the member whose latest accepted intent is on air,
 *   whether it is settled, still entering, or still waiting. It gives way. A waiting
 *   member is cancelled outright rather than sent to exit, because it never reached
 *   program and so has nothing to animate off; every other selection is Out'd
 *   normally, which reverses an entrance still in flight and starts a clean exit
 *   otherwise.
 * - **An older outgoing graphic** — already on its way off program before this
 *   command. Under Overlap it is cut off, so a channel racing through three graphics
 *   never accumulates exits; under Out then in the current outgoing graphic finishes
 *   normally, because that exit is precisely what the incoming graphic is waiting for.
 * - **Absent** — off, or settled off already. Untouched, which is what makes a
 *   duplicate Take of the member already selected write nothing at all.
 *
 * Cut collapses all of it: it bypasses the Graphic Channel Handoff Policy and
 * switches immediately, so every other member is cut off and the newcomer starts at
 * once.
 */
function channelHandoff(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	cut: boolean,
	context: BroadcastGraphicsReductionContext,
): { playout: Record<string, BroadcastGraphicPlayout>; entersAt: number } {
	const acceptedAt = context.acceptedAt;
	const channel = context.channel;
	if (!channel)
		return { playout: state.playout, entersAt: acceptedAt };

	let playout = state.playout;
	// Where the newcomer's enter may begin under Out then in: the latest authoritative
	// scheduled completion among the exits this channel is still running.
	let outgoingSettlesAt = acceptedAt;

	for (const member of channel.members) {
		if (member.graphicId === graphicId)
			continue;

		const current = playout[member.graphicId];
		if (!current)
			continue;

		if (current.onAir) {
			const waiting = channelHoldsWaiting(current, state, member.graphicId, channel, acceptedAt);
			const replaced = cut || waiting
				? cutOff(acceptedAt)
				: nextPlayout(current, { onAir: false, cut: false }, acceptedAt, member.durations);
			playout = { ...playout, [member.graphicId]: replaced };
			if (!cut && !waiting)
				outgoingSettlesAt = Math.max(outgoingSettlesAt, phaseSettlesAt(replaced, member.durations));
			continue;
		}

		// Off, or an exit that has already completed: nothing on program to hand over from.
		if (!enterExitFlight(current, { now: acceptedAt, durations: member.durations }))
			continue;

		if (cut || channel.handoff === 'overlap')
			playout = { ...playout, [member.graphicId]: cutOff(acceptedAt) };
		else
			outgoingSettlesAt = Math.max(outgoingSettlesAt, phaseSettlesAt(current, member.durations));
	}

	return {
		playout,
		entersAt: cut || channel.handoff === 'overlap' ? acceptedAt : outgoingSettlesAt,
	};
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
 *
 * A restatement performs no Graphic Channel handoff either, and that is not merely an
 * optimisation. Overlap cuts off an older outgoing graphic when a *new* selection
 * arrives; running that for a duplicate delivery of the Take that made this graphic
 * the selection would pop the graphic it is currently overlapping straight off
 * program. Duplicate delivery of the same action has no additional effect, and this is
 * where that rule reaches the rest of the channel. Cut Take is the exception: it
 * restates the same on-air target but demands the handoff happen immediately, so it
 * still runs.
 */
function reduceTake(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsPlayoutPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const cut = payload.cut === true;
	const current = state.playout[payload.graphicId];
	const restated = current?.onAir === true && !cut;

	const handoff = restated
		? { playout: state.playout, entersAt: context.acceptedAt }
		: channelHandoff(state, payload.graphicId, cut, context);

	const playout = {
		...handoff.playout,
		[payload.graphicId]: nextPlayout(
			current,
			{ onAir: true, cut },
			context.acceptedAt,
			context.durations,
			handoff.entersAt,
		),
	};
	if (current?.onAir)
		return { ...state, playout };

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const bound = boundValuesFor(state, payload.graphicId, context);
	const blocked = unavailableRequiredGraphicInputs(inputs, context.inputs, context.bindings, bound);
	if (blocked.length > 0) {
		throw new BroadcastGraphicsCommandRejection(
			'required-input-unavailable',
			`${blocked.map(declaration => declaration.label).join(', ')} must have a value before this Broadcast Graphic can go on air`,
			blocked.map(declaration => declaration.key),
		);
	}

	// An off-air acceptance: a Take composes its values afresh rather than holding a
	// value from the last time this graphic was on air.
	return {
		...withInputs(state, payload.graphicId, {
			...inputs,
			accepted: acceptGraphicInputValues(inputs, context.inputs, context.bindings, bound, false),
			acceptedRevision: inputs.acceptedRevision + 1,
		}),
		playout,
	};
}

/**
 * Out: state that this Broadcast Graphic is no longer the operator's desired on-air
 * intent.
 *
 * Ordinarily that is one assignment, and the exit it produces is the whole of it — a
 * graphic in a Graphic Channel leaves the channel empty rather than promoting anything,
 * because a channel holds the operator's latest selection and Out is the operator
 * selecting nothing.
 *
 * The one case that is not a plain exit is Out on a member its channel is still holding
 * waiting. Out cancels a waiting Take: the graphic is absent from every output, so
 * there is nothing on program to animate away, and running an exit phase would put a
 * graphic on air in order to take it back off again. It settles off at once instead,
 * whether or not the operator asked for Cut, because the phase Cut would have skipped
 * does not exist here.
 */
function reduceOut(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsPlayoutPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const current = state.playout[payload.graphicId];
	const waiting = channelHoldsWaiting(current, state, payload.graphicId, context.channel, context.acceptedAt);

	return {
		...state,
		playout: {
			...state.playout,
			[payload.graphicId]: waiting
				? cutOff(context.acceptedAt)
				: nextPlayout(
						current,
						{ onAir: false, cut: payload.cut === true },
						context.acceptedAt,
						context.durations,
					),
		},
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
	// A graphic its Graphic Channel is still holding is selected but absent from every
	// output, so there is no rendering for an update to transition and nothing an
	// operator would see accept. It enters with the values its Take accepted, which is
	// the same rule that makes editing an off graphic change its next Take's values.
	if (
		!playout?.onAir
		|| channelHoldsWaiting(playout, state, payload.graphicId, context.channel, context.acceptedAt)
	) {
		throw new BroadcastGraphicsCommandRejection(
			'update-unavailable',
			'Update Graphic is available only while a Broadcast Graphic is entering, on air, or updating',
		);
	}

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	if (payload.basedOnAcceptedRevision !== inputs.acceptedRevision) {
		throw new BroadcastGraphicsCommandRejection(
			'stale-input-acceptance',
			'Another operator has already accepted a newer Graphic Input set for this Broadcast Graphic',
		);
	}

	const bound = boundValuesFor(state, payload.graphicId, context);
	// An on-air acceptance: an input that has become unavailable keeps its last
	// accepted value, because program must not blank mid-show.
	const accepted = acceptGraphicInputValues(inputs, context.inputs, context.bindings, bound, true);
	const acceptedRevision = inputs.acceptedRevision + 1;
	const updateMs = durationOf(context.durations, 'update');

	if (payload.cut === true || updateMs <= 0 || sameGraphicInputValues(inputs.accepted, accepted)) {
		return {
			...withInputs(state, payload.graphicId, { ...inputs, accepted, acceptedRevision }),
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
				startedAt: Math.max(context.acceptedAt, phaseSettlesAt(playout, context.durations)),
				updateFrom: inputs.accepted,
				pendingUpdateFrom: undefined,
			};

	return {
		...withInputs(state, payload.graphicId, {
			...inputs,
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
 *
 * An input a Graphic Input Binding resolves takes its value from that binding
 * rather than from here, so this write is accepted but does not reach air while the
 * binding stands. Live Control offers a Graphic Input Override for a bound input
 * instead; this stays permissive because an author may add or remove a binding
 * under a running show, and refusing an operator's keystroke over that race would
 * be worse than storing a value the binding currently masks.
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

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	// The Field Ownership claim, checked against the one field this edit owns.
	//
	// Compared against what the operator was *shown*, which is the effective value —
	// an override first, then a resolving binding, then the working value resolved
	// against the declared default. That last case is the one the working value alone
	// used to cover, and it is still what an unbound Graphic Input shows, which is the
	// only kind Live Control writes here. Comparing against `working` would now make
	// the claim describe something the operator never saw for a bound input.
	requireClaimMatchesShownValue(state, payload.graphicId, payload.inputKey, payload.basedOn, context);

	const edited: NormalizedBroadcastGraphicInputsState = {
		...inputs,
		working: { ...inputs.working, [payload.inputKey]: payload.value },
	};

	return withFieldScopedAcceptance(state, payload.graphicId, edited, acceptLivePolicyValues(
		edited,
		context,
		boundValuesFor(state, payload.graphicId, context),
		state.playout[payload.graphicId]?.onAir === true,
		[payload.inputKey],
	));
}

/**
 * Set Override: mask this Graphic Input's binding with an operator's value, or clear
 * the mask.
 *
 * The binding keeps resolving underneath, which is the whole point: an operator
 * correcting one wrong value does not lose the live feed, and clearing the override
 * resumes whatever the binding resolves at that moment rather than whatever it
 * resolved when the override was set.
 */
function reduceSetOverride(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsSetOverridePayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	if (!isDeclaredGraphicInput(context.inputs, payload.inputKey)) {
		throw new BroadcastGraphicsCommandRejection(
			'unknown-input',
			`This Broadcast Graphic declares no Graphic Input named ${payload.inputKey}`,
			[payload.inputKey],
		);
	}

	// An override is field-scoped in exactly the way a working edit is, so it carries
	// the same Field Ownership claim and is refused on the same terms. Without it, the
	// one command an operator uses to correct a bound value would be the single hole in
	// that discipline: two operators masking the same input would silently clobber each
	// other while every other edit path refused to.
	requireClaimMatchesShownValue(state, payload.graphicId, payload.inputKey, payload.basedOn, context);

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const overrides = { ...inputs.overrides };

	if (payload.value === null) {
		// Clearing is always allowed, whatever the bindings say now. An author who removes
		// a binding leaves any override standing — precedence is override-first — so the
		// operator must always be able to take the mask off again.
		delete overrides[payload.inputKey];
	}
	else {
		// A Graphic Input Override masks a Graphic Input Binding. Setting one where there
		// is no binding would be a second way to hold a value, with no rule saying which
		// of the two wins, so it is refused rather than quietly becoming a manual value
		// under a different name. Live Control never asks for this: it writes a working
		// value for an unbound input and an override only for a bound one.
		if (!context.bindings?.some(binding => binding.inputKey === payload.inputKey)) {
			throw new BroadcastGraphicsCommandRejection(
				'override-unbound',
				`${payload.inputKey} has no Graphic Input Binding to override`,
				[payload.inputKey],
			);
		}
		overrides[payload.inputKey] = payload.value;
	}

	const edited: NormalizedBroadcastGraphicInputsState = { ...inputs, overrides };

	return withFieldScopedAcceptance(state, payload.graphicId, edited, acceptLivePolicyValues(
		edited,
		context,
		boundValuesFor(state, payload.graphicId, context),
		state.playout[payload.graphicId]?.onAir === true,
		[payload.inputKey],
	));
}

/**
 * Select Source: point one Graphic Source Selection at an entity, or clear it.
 *
 * Every Graphic Input Binding reading that selection re-resolves, and the On-air
 * Update Policy decides which of those resolved values reach air now: a live one
 * applies immediately, a staged one waits for Update Graphic. That is why the new
 * selection is resolved here rather than after the command — the acceptance this
 * command performs depends on its own effect.
 */
function reduceSelectSource(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsSelectSourcePayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const declaration = context.sources?.find(source => source.key === payload.sourceKey);
	if (!declaration || !isOperatorSelectedGraphicSource(declaration)) {
		throw new BroadcastGraphicsCommandRejection(
			'unknown-source',
			`This Broadcast Graphic has no operator-selected Graphic Source Selection named ${payload.sourceKey}`,
		);
	}

	const selections = { ...broadcastGraphicSourceSelections(state, payload.graphicId) };
	if (payload.selectionId === null)
		delete selections[payload.sourceKey];
	else
		selections[payload.sourceKey] = payload.selectionId;

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const bound = boundValuesFor(state, payload.graphicId, context, selections);

	return {
		...state,
		sources: { ...state.sources, [payload.graphicId]: selections },
		inputs: {
			...state.inputs,
			[payload.graphicId]: {
				...inputs,
				accepted: acceptLivePolicyValues(
					inputs,
					context,
					bound,
					state.playout[payload.graphicId]?.onAir === true,
				),
			},
		},
	};
}

/**
 * Resolve Bindings: re-resolve this Broadcast Graphic's bindings and let the On-air
 * Update Policy decide what that means.
 *
 * A live-policy input reaches air immediately; a staged one is left pending for an
 * Update Graphic, which is the same rule every other acceptance follows. The command
 * exists because Event Data changes without anybody issuing an operator action, and
 * a lower third bound to a Player who has just been renamed should say the new name.
 */
function reduceResolveBindings(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsResolveBindingsPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const inputs = broadcastGraphicInputsState(state, payload.graphicId);

	return withInputs(state, payload.graphicId, {
		...inputs,
		accepted: acceptLivePolicyValues(
			inputs,
			context,
			boundValuesFor(state, payload.graphicId, context),
			state.playout[payload.graphicId]?.onAir === true,
		),
	});
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
	const normalized: BroadcastGraphicsLiveState = {
		playout: state.playout ?? {},
		inputs: state.inputs ?? {},
		sources: state.sources ?? {},
	};

	switch (command.type) {
		case 'Take':
			return reduceTake(normalized, command.payload, context);
		case 'Out':
			return reduceOut(normalized, command.payload, context);
		case 'Update Graphic':
			return reduceUpdateGraphic(normalized, command.payload, context);
		case 'Set Input':
			return reduceSetInput(normalized, command.payload, context);
		case 'Set Override':
			return reduceSetOverride(normalized, command.payload, context);
		case 'Select Source':
			return reduceSelectSource(normalized, command.payload, context);
		case 'Resolve Bindings':
			return reduceResolveBindings(normalized, command.payload, context);
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
	/**
	 * The Graphic Channel this graphic belongs to, for a reader that has the Screen's
	 * whole stack in hand. Omitted answers every settled and animating state correctly
	 * and only leaves waiting unreachable, which is the right answer for a graphic in
	 * no channel and an honest one for a caller that cannot see the channel's members.
	 */
	channel?: BroadcastGraphicChannelContext,
): BroadcastGraphicPhaseTiming {
	return {
		now,
		durations: broadcastGraphicPhaseDurations(graphic),
		onScreen: broadcastGraphicHasPhaseAnimation(graphic, 'on-screen'),
		...(channel ? { channel } : {}),
	};
}

/**
 * The Graphic Channel context each placed Broadcast Graphic is read and reduced
 * against, keyed by Broadcast Graphic id.
 *
 * One derivation from authored Screen configuration, shared by the server that
 * reduces a Take and by every client that reads what is on air, so the instant a
 * handoff schedules and the instant a reader stops holding the incoming graphic
 * waiting are the same instant computed the same way.
 *
 * A Broadcast Graphic in no Graphic Channel — or in one the Screen no longer declares
 * — gets no entry, which is exactly the absent context that means "replaces nothing".
 */
export function broadcastGraphicChannelContexts(
	stack: {
		graphics: readonly BroadcastGraphicConfig[];
		channels?: readonly GraphicChannelConfig[];
	},
): Record<string, BroadcastGraphicChannelContext> {
	const contexts: Record<string, BroadcastGraphicChannelContext> = {};

	for (const channel of stack.channels ?? []) {
		const members = stack.graphics
			.filter(graphic => graphic.channelId === channel.id)
			.map(graphic => ({ graphicId: graphic.id, durations: broadcastGraphicPhaseDurations(graphic) }));
		if (members.length === 0)
			continue;

		// One object per channel rather than per member: the context describes the channel,
		// and every member reads the same one and skips itself by id.
		const context: BroadcastGraphicChannelContext = {
			handoff: graphicChannelHandoffPolicy(channel),
			members,
		};
		for (const member of members)
			contexts[member.graphicId] = context;
	}

	return contexts;
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
	/**
	 * The Graphic Channel this Broadcast Graphic belongs to, when the reader can see
	 * one. It is the only way waiting is reachable: waiting is not a fact about this
	 * graphic's own record but about whether its channel is still occupied.
	 */
	channel?: BroadcastGraphicChannelContext;
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
 * same statement as exit discarding a pending visual update.
 *
 * Waiting is answered before all of it. A graphic its Graphic Channel is still holding
 * has not begun any phase, so there is no phase for the axis below to be asked about —
 * and because a waiting graphic is absent from overlay, fill, and key alike, answering
 * it first is what keeps it off every output. Recovery resolves it away by itself: the
 * outgoing exit it waits on has long since completed by the time a restarted reader
 * looks, so what recovery finds is a graphic settled on air.
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

	if (channelHoldsWaiting(playout, state, graphicId, timing.channel, timing.now))
		return 'waiting';

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

	// A Broadcast Graphic its Graphic Channel is holding has not entered, so there is no
	// phase to project and nothing composes it into the frame to project one onto.
	if (channelHoldsWaiting(playout, state, graphicId, timing.channel, timing.now))
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
		phaseSettlesAt(playout, timing.durations),
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
