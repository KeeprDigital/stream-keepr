import type { BroadcastGraphicsLiveState } from './playout';
import { createInitialBroadcastGraphicInputsState } from './inputs';
import { createInitialBroadcastGraphicsLiveState } from './playout';

/**
 * What a reader does with durable live state it cannot trust.
 *
 * The Broadcast Graphics Live Session's state is one JSON column that survives
 * reloads, disconnections, and restarts, so every read of it is a read of
 * something written by another process — possibly a different build, possibly a
 * partial write. The settled rule is that missing, corrupt, or incompatible
 * durable live state renders every Broadcast Graphic transparent on every output
 * and shows Live Control a recovery fault that only an explicit Take clears.
 *
 * ## Why it recovers to nothing rather than to what it could read
 *
 * Salvaging the readable half is the dangerous option: program would show
 * whichever graphics happened to survive parsing, at values nobody accepted, and
 * an operator would have no way to tell that from a show running normally.
 * Answering "nothing is on air, and here is why" is the only answer that is
 * always safe on air and always legible to the operator.
 *
 * ## Why it tolerates fields it does not know
 *
 * The state grows: Graphic Channels add a sibling to `playout`, animation adds
 * fields inside each playout record. A validator that refused anything
 * unrecognised would turn every one of those additions into a recovery fault on
 * every reader that had not been updated yet — a self-inflicted outage. So this
 * judges exactly the fields it reads and passes the rest through untouched.
 */

/**
 * Why durable live state could not be trusted.
 *
 * - `missing` — there is no state at all where there should be one.
 * - `corrupt` — the state is there but is not the shape of live state.
 * - `incompatible` — the shape is right but a value inside it is of a type this
 *   build cannot interpret, which is what a state written under a different
 *   vocabulary looks like from here.
 */
export const BROADCAST_GRAPHICS_RECOVERY_FAULT_REASONS = ['missing', 'corrupt', 'incompatible'] as const;

export type BroadcastGraphicsRecoveryFaultReason = typeof BROADCAST_GRAPHICS_RECOVERY_FAULT_REASONS[number];

/** A recovery fault, with enough detail to be diagnosable rather than merely fatal. */
export interface BroadcastGraphicsRecoveryFault {
	reason: BroadcastGraphicsRecoveryFaultReason;
	/** What could not be read, named so an operator can report it. */
	detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fault(reason: BroadcastGraphicsRecoveryFaultReason, detail: string): BroadcastGraphicsRecoveryFault {
	return { reason, detail };
}

function playoutFault(playout: unknown): BroadcastGraphicsRecoveryFault | null {
	if (playout === undefined || playout === null)
		return null;
	if (!isRecord(playout))
		return fault('corrupt', 'the playout map is not a set of Broadcast Graphic records');

	for (const [graphicId, record] of Object.entries(playout)) {
		if (!isRecord(record))
			return fault('corrupt', `the playout record for ${graphicId} is not a record`);
		if ('onAir' in record && typeof record.onAir !== 'boolean')
			return fault('incompatible', `the on-air intent for ${graphicId} is not a true or false value`);
		if ('cut' in record && typeof record.cut !== 'boolean')
			return fault('incompatible', `the Cut modifier for ${graphicId} is not a true or false value`);
		// A start time that is not a number at all, which is a different thing from a
		// start time that is merely old. Animation deliberately trusts an old one
		// literally — the projection is monotone and saturating, so a start time from
		// before a crash has already passed its phase duration and settles at the
		// Graphic Resting State — and this must not second-guess that. But a
		// non-numeric value does not settle: it makes elapsed time NaN, and every
		// phase comparison against NaN is false, so an output would resolve a phase
		// nobody can predict. Refusing that is refusing corruption, not staleness.
		if ('effectiveStartedAt' in record && !Number.isFinite(record.effectiveStartedAt))
			return fault('incompatible', `the animation start time for ${graphicId} is not a number`);
	}

	return null;
}

function inputsFault(inputs: unknown): BroadcastGraphicsRecoveryFault | null {
	if (inputs === undefined || inputs === null)
		return null;
	if (!isRecord(inputs))
		return fault('corrupt', 'the Graphic Input map is not a set of Broadcast Graphic records');

	for (const [graphicId, record] of Object.entries(inputs)) {
		if (!isRecord(record))
			return fault('corrupt', `the Graphic Input record for ${graphicId} is not a record`);
		for (const slot of ['working', 'accepted'] as const) {
			if (slot in record && !isRecord(record[slot]))
				return fault('corrupt', `the ${slot} Graphic Input values for ${graphicId} are not a set of values`);
		}
		if ('acceptedRevision' in record && !Number.isFinite(record.acceptedRevision))
			return fault('incompatible', `the Graphic Input acceptance revision for ${graphicId} is not a number`);
	}

	return null;
}

/**
 * Judge one durable live state, or report why it cannot be trusted.
 *
 * Answering `null` is the claim that every field this build reads is present in a
 * shape it can read — not that the state is exhaustively understood.
 */
export function broadcastGraphicsRecoveryFault(raw: unknown): BroadcastGraphicsRecoveryFault | null {
	if (raw === undefined || raw === null)
		return fault('missing', 'this Broadcast Graphics Live Session has no durable live state');
	if (!isRecord(raw))
		return fault('corrupt', 'the durable live state is not a live state record');

	return playoutFault(raw.playout) ?? inputsFault(raw.inputs);
}

/**
 * The live state a reader should act on.
 *
 * Trustworthy state is returned as it is, extra fields and all. Anything else
 * becomes a fresh state — nothing on air, no accepted values — which is what
 * makes every output transparent while the fault stands.
 */
export function recoveredBroadcastGraphicsLiveState(raw: unknown): BroadcastGraphicsLiveState {
	if (broadcastGraphicsRecoveryFault(raw) !== null)
		return createInitialBroadcastGraphicsLiveState();

	const state = raw as Partial<BroadcastGraphicsLiveState>;
	return {
		...state,
		playout: state.playout ?? {},
		inputs: state.inputs ?? {},
		// Normalised like the other two: a session persisted before Graphic Source
		// Selections existed carries no such key, and every reader expects the map.
		sources: state.sources ?? {},
	} as BroadcastGraphicsLiveState;
}

/**
 * The state the next Broadcast Graphics Live Session opens with, given the one
 * that just ended.
 *
 * Playout never crosses an epoch boundary: ending a session turns every Broadcast
 * Graphic off, and a stale on-air intent surviving into a later show is exactly
 * what epochs exist to prevent. Prepared *working* values are the opposite case —
 * they are not an intent to show anything, they are the work an operator did to be
 * ready, and losing them to a mode change means retyping a show's lower thirds
 * mid-show.
 *
 * ## Why accepted values do not cross the boundary
 *
 * An accepted value is by definition what an on-air Broadcast Graphic *is
 * rendering*, and nothing is on air in a new epoch — so there is no rendering for
 * it to be the last accepted state of. Carrying it would not merely be redundant,
 * it would be unsound: acceptance falls back to the previously accepted value when
 * a working value is unavailable, and the Take gate measures requiredness against
 * what acceptance would produce. A required Graphic Input whose carried working
 * value is unavailable would therefore pass the gate on the strength of an
 * acceptance from a show that is over, and go on air showing the old epoch's value
 * — against the settled rule that a required unavailable Graphic Input prevents a
 * Take. Within one epoch that same fallback is correct, because there the last
 * accepted value really is what program is showing.
 *
 * The acceptance revision goes with it: it counts acceptances, and the new epoch
 * has had none.
 *
 * ## Why Graphic Source Selections and Overrides do cross it
 *
 * Both fall on the working-value side of that line rather than the accepted side.
 * A Graphic Source Selection says *which* Player this lower third is about; a
 * Graphic Input Override is an operator's correction that persists across hide and
 * show cycles by definition. Neither is an intent to show anything, and losing
 * either to a mode change means re-picking every source and re-typing every
 * correction mid-show.
 *
 * Neither carries the unsoundness that rules accepted values out, and the reason is
 * worth stating: that hazard was acceptance falling back to a *previous* accepted
 * value, letting a required input pass the Take gate on the strength of a show that
 * is over. A selection and an override are current values, re-resolved and
 * re-judged against the declaration at the moment of the next Take — and the Take
 * gate no longer consults previously accepted values at all.
 *
 * State that cannot be trusted carries nothing forward: the same reasoning that
 * refuses to salvage half a playout map refuses to salvage half an input map.
 */
export function carriedForwardBroadcastGraphicsLiveState(raw: unknown): BroadcastGraphicsLiveState {
	const recovered = recoveredBroadcastGraphicsLiveState(raw);
	const inputs = Object.fromEntries(
		Object.entries(recovered.inputs).map(([graphicId, stored]) => [graphicId, {
			...createInitialBroadcastGraphicInputsState(),
			working: stored.working ?? {},
			overrides: stored.overrides ?? {},
		}]),
	);

	return { ...createInitialBroadcastGraphicsLiveState(), inputs, sources: recovered.sources ?? {} };
}
