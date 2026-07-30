import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	acceptedGraphicInputValues,
	applyBroadcastGraphicsCommand,
	broadcastGraphicInputsState,
	broadcastGraphicPhaseProjection,
	broadcastGraphicPlayoutState,
	broadcastGraphicRenderedInputs,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';

/** A fixed authoritative clock, so nothing here depends on wall time. */
const T0 = 1_700_000_000_000;

function graphic(id: string): BroadcastGraphicConfig {
	return { id, name: id, items: [] };
}

/** A one-second enter, a half-second exit, and a 400ms update: a plausible authored set. */
const TIMING = { enter: 1000, exit: 500, update: 400 };

/**
 * A Broadcast Graphic declaring no Graphic Inputs: playout alone.
 *
 * The durations travel with acceptance as well as with every read, because deciding
 * whether the phase an intent interrupts is still running is an authoritative
 * question rather than one each output answers for itself.
 */
const NO_INPUTS = { inputs: [], durations: TIMING };

function take(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	cut = false,
	acceptedAt = T0,
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(
		state,
		{ type: 'Take', payload: { graphicId, cut } },
		{ ...NO_INPUTS, acceptedAt },
	);
}

function out(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	cut = false,
	acceptedAt = T0,
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(
		state,
		{ type: 'Out', payload: { graphicId, cut } },
		{ ...NO_INPUTS, acceptedAt },
	);
}

function at(now: number) {
	return { now, durations: TIMING };
}

describe('broadcastGraphicsPlayout', () => {
	it('starts with every placed Broadcast Graphic off', () => {
		const state = createInitialBroadcastGraphicsLiveState();

		expect(broadcastGraphicPlayoutState(state, 'lower-third')).toBe('off');
		expect(onAirBroadcastGraphicIds(state, [graphic('lower-third')])).toEqual([]);
	});

	it('takes a Broadcast Graphic to on-air and outs it back to off', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'lower-third');
		expect(broadcastGraphicPlayoutState(taken, 'lower-third')).toBe('on-air');

		const outed = out(taken, 'lower-third');
		expect(broadcastGraphicPlayoutState(outed, 'lower-third')).toBe('off');
	});

	it('is idempotent under repeated Take and repeated Out', () => {
		const once = take(createInitialBroadcastGraphicsLiveState(), 'bug');
		const twice = take(once, 'bug');
		expect(twice).toEqual(once);

		const outOnce = out(twice, 'bug');
		const outTwice = out(outOnce, 'bug');
		expect(outTwice).toEqual(outOnce);
	});

	it('reaches the same on-air target whether or not the action was Cut', () => {
		const initial = createInitialBroadcastGraphicsLiveState();

		expect(broadcastGraphicPlayoutState(take(initial, 'slate', true), 'slate')).toBe('on-air');
		expect(broadcastGraphicPlayoutState(take(initial, 'slate', false), 'slate')).toBe('on-air');
		expect(broadcastGraphicPlayoutState(out(take(initial, 'slate'), 'slate', true), 'slate')).toBe('off');
	});

	it('lets the last accepted intent for one Broadcast Graphic win', () => {
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'slate');
		state = out(state, 'slate');
		state = take(state, 'slate');

		expect(broadcastGraphicPlayoutState(state, 'slate')).toBe('on-air');
	});

	it('leaves other Broadcast Graphics untouched', () => {
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'bug');
		state = take(state, 'lower-third');
		state = out(state, 'lower-third');

		expect(broadcastGraphicPlayoutState(state, 'bug')).toBe('on-air');
		expect(broadcastGraphicPlayoutState(state, 'lower-third')).toBe('off');
	});

	it('never mutates the state it reduces', () => {
		const initial = createInitialBroadcastGraphicsLiveState();
		const snapshot = structuredClone(initial);

		take(initial, 'slate');

		expect(initial).toEqual(snapshot);
	});

	it('reports concurrent on-air Broadcast Graphics in authored stack order, not take order', () => {
		const stack = [graphic('back'), graphic('middle'), graphic('front')];
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'front');
		state = take(state, 'back');

		expect(onAirBroadcastGraphicIds(state, stack)).toEqual(['back', 'front']);
	});

	it('omits a Broadcast Graphic that is no longer in the authored stack', () => {
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'deleted');
		state = take(state, 'kept');

		expect(onAirBroadcastGraphicIds(state, [graphic('kept')])).toEqual(['kept']);
	});
});

describe('the persisted playout shape, and the no-replay invariant it has to keep', () => {
	it('persists the accepted intent and one authoritative effective start time', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// #64 asserted this key set so that widening the durable shape could not happen
		// without answering the question it encodes: would recovery replay animation?
		//
		// The answer this ticket lands is that it cannot, and the reason is the shape
		// itself. What is stored is the *accepted intent* plus the one authoritative
		// instant its phase began, and nothing else. No lifecycle phase is stored, so
		// there is no phase for recovery to resume; and the start time is not a
		// checkpoint that recovery has to validate or clear, because reading it
		// literally is what produces the settled answer — the projection below is
		// monotone in elapsed time and saturates at completion, so a start time from
		// before a restart can only ever resolve *forwards* to the Graphic Resting
		// State.
		//
		// The two rejected alternatives are the reason this test still exists rather
		// than simply being updated: persisting a phase would make recovery resume it,
		// and persisting a start time that recovery *reset* would make recovery replay
		// from it. If a later ticket needs a third field here, it should have to argue
		// the same case again.
		// Accepted Graphic Input values are stored beside playout, and are the
		// deliberate exception: they are the values a recovered graphic renders at its
		// resting state, not a record of how it got there, so nothing about them is
		// replayable either.
		expect(Object.keys(persisted).toSorted()).toEqual(['inputs', 'playout']);
		expect(Object.keys(persisted.playout.slate!).toSorted()).toEqual(['cut', 'effectiveStartedAt', 'onAir']);
		expect(persisted.playout.slate).toEqual({ onAir: true, effectiveStartedAt: T0, cut: false });
	});

	it('adds a scheduled reversal completion only to an intent that actually interrupted a phase', () => {
		// Live animation is where the third field stopped being enough, and this is the
		// fourth field arguing its case rather than quietly appearing.
		//
		// What it stores is *where a reversal began*. Out during enter has to reverse the
		// entrance from the frame currently on program, and the persisted intent cannot
		// express that: `{ onAir: false, effectiveStartedAt, cut }` says a graphic is
		// leaving, not that it is halfway through arriving. It is one number rather than
		// a per-owner snapshot because the rendered state of every owner in the graphic —
		// whole-graphic recipe, every item, every stagger — is a pure function of one
		// position in phase time, so one position is the whole of what has to be stored.
		//
		// It is stored as a scheduled *completion* instant, and that is the part that
		// answers #69's test rather than merely satisfying it. The self-healing property
		// #69 relied on was not "the field is correct when fresh", it was "reading the
		// field literally, with no validation and no clearing, is what produces the
		// settled answer". A completion instant has that property in its strongest form:
		// `now >= reversalCompletesAt` settles it, needing nothing from Screen
		// configuration at all, and the projected elapsed time is
		// `reversalCompletesAt - now`, which falls monotonically to zero and clamps.
		// Zero is the far end of the phase being unwound — fully off for a reversed
		// enter, the Graphic Resting State for a reversed exit — which is exactly the
		// settled state of the intent that wrote the field. A stale read is therefore not
		// merely harmless here, it is correct, and the two shapes #69 rejected are still
		// rejected: no phase is written down, so nothing can be resumed as a phase, and
		// nothing resets the instant, so nothing can replay from it.
		//
		// The last thing that keeps the shape honest is its absence. A Broadcast Graphic
		// that was never interrupted stores exactly the three fields above, so the
		// durable record grows only for the graphics that actually reversed.
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversed = out(entering, 'slate', false, T0 + 300);

		expect(Object.keys(reversed.playout.slate!).toSorted())
			.toEqual(['cut', 'effectiveStartedAt', 'onAir', 'reversalCompletesAt']);
		expect(reversed.playout.slate).toEqual({
			onAir: false,
			effectiveStartedAt: T0 + 300,
			cut: false,
			reversalCompletesAt: T0 + 600,
		});

		// Read four hours late, with nothing having cleared or validated anything.
		const hoursLater = T0 + (4 * 60 * 60 * 1000);
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(hoursLater))).toBe('off');
		expect(broadcastGraphicPhaseProjection(reversed, 'slate', at(hoursLater))).toBeNull();
	});

	it('adds an update phase start only while an update animation is still owed', () => {
		// The fifth field, and the same argument in the same form. An update phase needs
		// its own authoritative effective start time because it is not the phase the
		// on-air intent began, and it needs one rather than an acknowledgement because
		// coalescing — during enter into one update afterwards, during an update into one
		// pending rendering — is a fact about the authoritative order that every output
		// has to agree on without asking anyone.
		//
		// It is a start rather than a completion instant, unlike the reversal above, and
		// the difference is real rather than an inconsistency: an update's length *is*
		// derivable from Screen configuration, which every reader already holds because
		// it is rendering that composition, whereas a reversal's length depends on when
		// an operator pressed and cannot be recovered from anything. Where the two agree
		// is the property that matters: `rollUpdateChain` walks the stored chain forward
		// against `now` and returns nothing once it is spent, so it is monotone and
		// saturating, and a chain read after a restart reports no update rather than an
		// old one.
		const declaration: GraphicInputDeclaration = {
			key: 'headline',
			label: 'Headline',
			required: false,
			updatePolicy: 'staged',
			type: 'text',
			default: '',
			maxLength: 80,
		};
		const context = { inputs: [declaration], durations: TIMING };
		let state = applyBroadcastGraphicsCommand(
			createInitialBroadcastGraphicsLiveState(),
			{ type: 'Take', payload: { graphicId: 'slate', cut: false } },
			{ ...context, acceptedAt: T0 },
		);
		state = applyBroadcastGraphicsCommand(
			state,
			{ type: 'Set Input', payload: { graphicId: 'slate', inputKey: 'headline', value: 'next' } },
			{ ...context, acceptedAt: T0 + 2000 },
		);
		state = applyBroadcastGraphicsCommand(
			state,
			{ type: 'Update Graphic', payload: { graphicId: 'slate', cut: false, basedOnAcceptedRevision: 1 } },
			{ ...context, acceptedAt: T0 + 2000 },
		);

		expect(Object.keys(state.playout.slate!).toSorted())
			.toEqual(['cut', 'effectiveStartedAt', 'onAir', 'updateStartedAt']);
		// The rendering it transitions away from is stored beside the accepted values it
		// is made of, because an output that joins mid-update has to have both.
		expect(Object.keys(state.inputs.slate!).toSorted())
			.toEqual(['accepted', 'acceptedRevision', 'updateFrom', 'working']);

		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(state));
		const hoursLater = T0 + (4 * 60 * 60 * 1000);
		expect(broadcastGraphicPlayoutState(recovered, 'slate', at(hoursLater))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(recovered, 'slate', at(hoursLater))).toBeNull();
		expect(broadcastGraphicRenderedInputs(recovered, 'slate', [declaration], at(hoursLater)))
			.toEqual({ current: { headline: 'next' } });
	});

	it('stores no lifecycle phase, so there is nothing for recovery to resume', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate');
		const reversing = out(entering, 'slate', false, T0 + 300);

		for (const persisted of [entering, reversing]) {
			const serialized = JSON.stringify(persisted);
			for (const phase of ['waiting', 'entering', 'on-air', 'updating', 'exiting', 'phase', 'state'])
				expect(serialized).not.toContain(phase);
		}
	});

	it('recovers a target-on-air Broadcast Graphic settled at its Graphic Resting State', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// A reload, disconnect, or server restart reaches the reducer as nothing but
		// the JSON that was in the session's text column.
		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(persisted));

		expect(broadcastGraphicPlayoutState(recovered, 'slate')).toBe('on-air');
		expect(onAirBroadcastGraphicIds(recovered, [graphic('slate')])).toEqual(['slate']);
	});

	it('settles a graphic taken before a restart rather than replaying its entrance', () => {
		// The failure this guards is an operator-visible one: a mid-show crash that
		// makes a lower third fly back on over program. The graphic was taken hours
		// ago, so by the time anything reads its start time the enter phase is long
		// over — and that is true without recovery doing anything about it.
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');
		const hoursLater = T0 + (4 * 60 * 60 * 1000);

		expect(broadcastGraphicPlayoutState(persisted, 'slate', at(hoursLater))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(persisted, 'slate', at(hoursLater))).toBeNull();
	});

	it('catches a late-loading output up to the current phase instead of restarting it', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// An output that opens 400ms into a one-second enter joins 400ms in, and one
		// that opens after it joins settled. Neither starts from zero.
		expect(broadcastGraphicPhaseProjection(taken, 'slate', at(T0 + 400)))
			.toEqual({ phase: 'enter', elapsed: 400 });
		expect(broadcastGraphicPhaseProjection(taken, 'slate', at(T0 + 1500))).toBeNull();
	});

	it('never lets a duplicated Take restart an entrance already on program', () => {
		// Idempotence has to reach the animation, not only the target state: the second
		// delivery of the same Take arrives 300ms in and must not reset the clock.
		const first = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const duplicate = take(first, 'slate', false, T0 + 300);

		// The *record* is the same object, which is the property that matters: the
		// reducer rebuilds the state wrapper on every command, but leaving the playout
		// record untouched is what keeps the effective start time from being refreshed.
		expect(duplicate.playout.slate).toBe(first.playout.slate);
		expect(duplicate.playout.slate!.effectiveStartedAt).toBe(T0);
		expect(broadcastGraphicPhaseProjection(duplicate, 'slate', at(T0 + 600)))
			.toEqual({ phase: 'enter', elapsed: 600 });
	});

	it('starts a new phase when the intent actually changes', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const outed = out(taken, 'slate', false, T0 + 5000);

		expect(broadcastGraphicPhaseProjection(outed, 'slate', at(T0 + 5200)))
			.toEqual({ phase: 'exit', elapsed: 200 });
	});

	it('never replays an entrance when a plain Take follows a Cut Take', () => {
		// Cut Take settles the graphic on air immediately. A plain Take after it reaches
		// the same target, so it must change nothing — writing a fresh effective start
		// time would send a settled graphic back to `entering` and replay its entrance
		// on program, which is the failure an operator would see as a mid-show glitch.
		const cut = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);
		const plain = take(cut, 'slate', false, T0 + 5000);

		expect(plain.playout.slate).toBe(cut.playout.slate);
		expect(broadcastGraphicPlayoutState(plain, 'slate', at(T0 + 5000))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(plain, 'slate', at(T0 + 5000))).toBeNull();
	});

	it('never replays an exit when a plain Out follows a Cut Out', () => {
		// The same rule off air, where the consequence is worse: a fresh record would
		// make an already-off graphic `exiting`, which puts it back into the composed
		// frame to play an exit it already skipped.
		let state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const cut = out(state, 'slate', true, T0 + 1000);
		state = out(cut, 'slate', false, T0 + 5000);

		expect(state.playout.slate).toBe(cut.playout.slate);
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 5000))).toBe('off');
		expect(onAirBroadcastGraphicIds(state, [graphic('slate')], at(T0 + 5000))).toEqual([]);
	});

	it('still lets Cut settle a phase that is already running', () => {
		// The asymmetry the rule turns on: Cut arriving over a non-Cut intent is a real
		// change even though it reaches the same target, because it has to cut the
		// running phase short. Only the reverse direction is a no-op.
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		expect(broadcastGraphicPlayoutState(entering, 'slate', at(T0 + 200))).toBe('entering');

		const settled = take(entering, 'slate', true, T0 + 200);
		expect(settled.playout.slate).not.toBe(entering.playout.slate);
		expect(broadcastGraphicPlayoutState(settled, 'slate', at(T0 + 200))).toBe('on-air');
	});

	it('is idempotent under a repeated Cut Take', () => {
		const once = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);
		const twice = take(once, 'slate', true, T0 + 300);

		expect(twice.playout.slate).toBe(once.playout.slate);
	});

	it('starts a new phase when the same intent arrives with a different Cut', () => {
		// Cut is part of the accepted intent, so a Cut Take after a plain one is a
		// different intent and settles the graphic immediately.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const recut = take(taken, 'slate', true, T0 + 200);

		expect(broadcastGraphicPlayoutState(recut, 'slate', at(T0 + 300))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(recut, 'slate', at(T0 + 300))).toBeNull();
	});
});

describe('deriving a lifecycle phase from the authoritative effective start time', () => {
	it('reports only settled states when no timing is supplied', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		expect(broadcastGraphicPlayoutState(taken, 'slate')).toBe('on-air');
		expect(broadcastGraphicPlayoutState(out(taken, 'slate', false, T0 + 10), 'slate')).toBe('off');
	});

	it('reports entering inside the enter phase and on-air after it', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		expect(broadcastGraphicPlayoutState(taken, 'slate', at(T0))).toBe('entering');
		expect(broadcastGraphicPlayoutState(taken, 'slate', at(T0 + 999))).toBe('entering');
		expect(broadcastGraphicPlayoutState(taken, 'slate', at(T0 + 1000))).toBe('on-air');
	});

	it('reports exiting inside the exit phase and off after it', () => {
		const outed = out(take(createInitialBroadcastGraphicsLiveState(), 'slate'), 'slate', false, T0 + 5000);

		expect(broadcastGraphicPlayoutState(outed, 'slate', at(T0 + 5000))).toBe('exiting');
		expect(broadcastGraphicPlayoutState(outed, 'slate', at(T0 + 5499))).toBe('exiting');
		expect(broadcastGraphicPlayoutState(outed, 'slate', at(T0 + 5500))).toBe('off');
	});

	it('completes a phase immediately when nothing is authored for it', () => {
		// A missing Graphic Animation Recipe completes its phase immediately, which is
		// a zero duration rather than a special case beside one.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		expect(broadcastGraphicPlayoutState(taken, 'slate', { now: T0, durations: {} })).toBe('on-air');
		expect(broadcastGraphicPlayoutState(taken, 'slate', { now: T0, durations: { enter: 0 } })).toBe('on-air');
	});

	it('completes a Cut phase immediately, without changing the target it reaches', () => {
		const cut = take(createInitialBroadcastGraphicsLiveState(), 'slate', true);

		expect(broadcastGraphicPlayoutState(cut, 'slate', at(T0))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(cut, 'slate', at(T0))).toBeNull();
	});

	it('keeps an exiting Broadcast Graphic on program until its exit completes', () => {
		// A graphic leaves the frame when its exit finishes, not when Out is accepted.
		const outed = out(take(createInitialBroadcastGraphicsLiveState(), 'slate'), 'slate', false, T0 + 5000);
		const stack = [graphic('slate')];

		expect(onAirBroadcastGraphicIds(outed, stack, at(T0 + 5200))).toEqual(['slate']);
		expect(onAirBroadcastGraphicIds(outed, stack, at(T0 + 5600))).toEqual([]);
	});

	it('composes an entering Broadcast Graphic, in authored stack order', () => {
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'front', false, T0);
		state = take(state, 'back', false, T0 + 100);

		expect(onAirBroadcastGraphicIds(state, [graphic('back'), graphic('front')], at(T0 + 200)))
			.toEqual(['back', 'front']);
	});

	it('never projects a negative elapsed time from a start time in the future', () => {
		// Client clocks drift from the server's, so a snapshot can arrive with a start
		// time slightly ahead of the reader's own clock.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0 + 40);

		expect(broadcastGraphicPhaseProjection(taken, 'slate', at(T0))).toEqual({ phase: 'enter', elapsed: 0 });
	});
});

describe('the clock an output does not own', () => {
	// An effective start time is stamped with the authoritative clock, so it is never
	// genuinely in the future. A start time that looks like it is means the *reader's*
	// clock is behind, and the sign of that being handled is not the same as its
	// magnitude being handled.

	it('leaves an Out Broadcast Graphic on program for no longer than its exit lasts', () => {
		// The failure this exists for, stated as an operator would see it: a browser
		// whose clock is a minute behind the server's would hold an exiting graphic on
		// program for that whole minute, because a graphic leaves the frame when its
		// exit completes. A capture output stuck showing a graphic the operator has
		// already taken off is the worst outcome available here.
		const outed = out(take(createInitialBroadcastGraphicsLiveState(), 'slate'), 'slate', false, T0 + 5000);
		const minuteBehind = T0 + 5000 - 60_000;

		expect(broadcastGraphicPlayoutState(outed, 'slate', at(minuteBehind))).toBe('off');
		expect(onAirBroadcastGraphicIds(outed, [graphic('slate')], at(minuteBehind))).toEqual([]);
	});

	it('settles rather than pinning an entrance when the reader is further behind than the phase lasts', () => {
		// The same bound on the way on air, where the consequence is a replay: pinned at
		// full excursion for the length of the skew and then playing the entrance from
		// zero, which is the replay the no-replay invariant forbids arriving through the
		// clock instead of through the stored field.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(broadcastGraphicPlayoutState(taken, 'slate', at(T0 - 30_000))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(taken, 'slate', at(T0 - 30_000))).toBeNull();
	});

	it('bounds a reversal by the phase it reverses rather than by the skew', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversed = out(entering, 'slate', false, T0 + 400);

		// The reversal is scheduled to complete 400ms after it started. A reader half a
		// minute behind cannot be inside it.
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 400 - 30_000))).toBe('off');
	});
});

describe('reversing an interruption from the currently rendered state', () => {
	it('reverses an entrance when Out interrupts it, taking as long as it had taken to arrive', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversed = out(entering, 'slate', false, T0 + 300);

		// 300ms into a one-second entrance, so the reversal starts from 300ms of enter
		// and unwinds it to zero over the next 300ms: the same recipe, played backwards.
		expect(broadcastGraphicPhaseProjection(reversed, 'slate', at(T0 + 300)))
			.toEqual({ phase: 'enter', elapsed: 300 });
		expect(broadcastGraphicPhaseProjection(reversed, 'slate', at(T0 + 400)))
			.toEqual({ phase: 'enter', elapsed: 200 });
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 400))).toBe('exiting');

		// And it is off the moment the reversal lands, not a frame later.
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 600))).toBe('off');
		expect(broadcastGraphicPhaseProjection(reversed, 'slate', at(T0 + 600))).toBeNull();
	});

	it('reverses an exit when Take interrupts it', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		state = out(state, 'slate', false, T0 + 5000);
		const reversed = take(state, 'slate', false, T0 + 5200);

		// 200ms into a half-second exit: the exit unwinds over 200ms and the graphic is
		// back at its Graphic Resting State, on air, without playing an entrance.
		expect(broadcastGraphicPhaseProjection(reversed, 'slate', at(T0 + 5200)))
			.toEqual({ phase: 'exit', elapsed: 200 });
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 5300))).toBe('entering');
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 5400))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(reversed, 'slate', at(T0 + 5400))).toBeNull();
	});

	it('resumes the interrupted phase forwards when the operator changes their mind twice', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversing = out(entering, 'slate', false, T0 + 400);
		// 100ms into unwinding, so 300ms of the entrance is still rendered.
		const resumed = take(reversing, 'slate', false, T0 + 500);

		expect(broadcastGraphicPhaseProjection(resumed, 'slate', at(T0 + 500)))
			.toEqual({ phase: 'enter', elapsed: 300 });
		// It runs on from there rather than restarting: 300ms rendered plus 200ms more.
		expect(broadcastGraphicPhaseProjection(resumed, 'slate', at(T0 + 700)))
			.toEqual({ phase: 'enter', elapsed: 500 });
		expect(broadcastGraphicPlayoutState(resumed, 'slate', at(T0 + 1200))).toBe('on-air');
	});

	it('does not reverse a phase that had already completed', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const outed = out(taken, 'slate', false, T0 + 5000);

		expect(outed.playout.slate).toEqual({ onAir: false, effectiveStartedAt: T0 + 5000, cut: false });
		expect(broadcastGraphicPhaseProjection(outed, 'slate', at(T0 + 5100)))
			.toEqual({ phase: 'exit', elapsed: 100 });
	});

	it('does not reverse a Cut phase, because a Cut phase was never in flight', () => {
		const cut = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);
		const outed = out(cut, 'slate', false, T0 + 100);

		expect(outed.playout.slate!.reversalCompletesAt).toBeUndefined();
		expect(broadcastGraphicPhaseProjection(outed, 'slate', at(T0 + 200)))
			.toEqual({ phase: 'exit', elapsed: 100 });
	});

	it('lets Cut Out settle a reversal that is still unwinding', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversing = out(entering, 'slate', false, T0 + 400);
		const cut = out(reversing, 'slate', true, T0 + 500);

		expect(cut.playout.slate!.reversalCompletesAt).toBeUndefined();
		expect(broadcastGraphicPlayoutState(cut, 'slate', at(T0 + 500))).toBe('off');
	});

	it('is still idempotent while a reversal is unwinding', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversing = out(entering, 'slate', false, T0 + 400);
		const again = out(reversing, 'slate', false, T0 + 500);

		expect(again.playout.slate).toBe(reversing.playout.slate);
	});

	it('composes a reversing Broadcast Graphic until its reversal completes', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversed = out(entering, 'slate', false, T0 + 300);
		const stack = [graphic('slate')];

		expect(onAirBroadcastGraphicIds(reversed, stack, at(T0 + 500))).toEqual(['slate']);
		expect(onAirBroadcastGraphicIds(reversed, stack, at(T0 + 700))).toEqual([]);
	});
});

describe('the update phase, and the renderings it cross-transitions', () => {
	const HEADLINE: GraphicInputDeclaration = {
		key: 'headline',
		label: 'Headline',
		required: false,
		updatePolicy: 'staged',
		type: 'text',
		default: '',
		maxLength: 80,
	};

	const CONTEXT = { inputs: [HEADLINE], durations: TIMING };

	function apply(
		state: BroadcastGraphicsLiveState,
		command: Parameters<typeof applyBroadcastGraphicsCommand>[1],
		acceptedAt: number,
	): BroadcastGraphicsLiveState {
		return applyBroadcastGraphicsCommand(state, command, { ...CONTEXT, acceptedAt });
	}

	function edit(state: BroadcastGraphicsLiveState, value: string, acceptedAt: number) {
		return apply(state, { type: 'Set Input', payload: { graphicId: 'slate', inputKey: 'headline', value } }, acceptedAt);
	}

	function accept(state: BroadcastGraphicsLiveState, acceptedAt: number, cut = false) {
		return apply(state, {
			type: 'Update Graphic',
			payload: {
				graphicId: 'slate',
				cut,
				basedOnAcceptedRevision: broadcastGraphicInputsState(state, 'slate').acceptedRevision,
			},
		}, acceptedAt);
	}

	function taken(acceptedAt = T0) {
		return apply(createInitialBroadcastGraphicsLiveState(), { type: 'Take', payload: { graphicId: 'slate', cut: false } }, acceptedAt);
	}

	function rendered(state: BroadcastGraphicsLiveState, now: number) {
		return broadcastGraphicRenderedInputs(state, 'slate', [HEADLINE], at(now));
	}

	/** On air and settled: enter is over, nothing pending. */
	function settledOnAir(headline: string) {
		let state = edit(createInitialBroadcastGraphicsLiveState(), headline, T0 - 10);
		state = apply(state, { type: 'Take', payload: { graphicId: 'slate', cut: false } }, T0);
		return state;
	}

	it('reports updating for the length of the update phase, then on-air again', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);

		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2000))).toBe('updating');
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2399))).toBe('updating');
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2400))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(state, 'slate', at(T0 + 2100)))
			.toEqual({ phase: 'update', elapsed: 100 });
	});

	it('cross-transitions the old and the new rendering, and only during the update', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);

		// Both renderings are in the authoritative snapshot, which is what lets an output
		// that joins mid-update transition rather than cut.
		expect(rendered(state, T0 + 2100)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: 'first' },
		});
		// Once the phase is over there is one rendering again, and it is the new one.
		expect(rendered(state, T0 + 2400)).toEqual({ current: { headline: 'second' } });
	});

	it('coalesces every acceptance during enter into one update after enter completes', () => {
		let state = taken();
		state = edit(state, 'first', T0 + 100);
		state = accept(state, T0 + 100);
		state = edit(state, 'second', T0 + 200);
		state = accept(state, T0 + 200);

		// Still entering, so program shows the rendering it entered with and neither
		// acceptance has animated.
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 300))).toBe('entering');
		expect(rendered(state, T0 + 300)).toEqual({ current: { headline: '' } });

		// One update, starting when the entrance completes, going straight to the latest
		// accepted values — the intermediate acceptance never gets its own animation.
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 1000))).toBe('updating');
		expect(rendered(state, T0 + 1100)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: '' },
		});
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 1400))).toBe('on-air');
	});

	it('holds an acceptance during an update as one pending rendering, and never queues', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		// 100ms into the update: the pending rendering waits for it to finish.
		state = edit(state, 'third', T0 + 2100);
		state = accept(state, T0 + 2100);
		// And a third acceptance replaces that pending rendering rather than adding to it.
		state = edit(state, 'fourth', T0 + 2200);
		state = accept(state, T0 + 2200);

		// The active update still finishes what it was doing.
		expect(rendered(state, T0 + 2300)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: 'first' },
		});
		// Then one further transition, to the latest values only.
		expect(rendered(state, T0 + 2500)).toEqual({
			current: { headline: 'fourth' },
			outgoing: { headline: 'second' },
		});
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2500))).toBe('updating');
		// Two transitions and no more: the chain is bounded however many acceptances arrive.
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2800))).toBe('on-air');
		expect(rendered(state, T0 + 2800)).toEqual({ current: { headline: 'fourth' } });
	});

	it('never rolls back accepted values when an update is interrupted', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = edit(state, 'third', T0 + 2100);
		state = accept(state, T0 + 2100);

		// Live Control reports the newest acceptance as accepted the moment it lands,
		// however far behind the animation is.
		expect(acceptedGraphicInputValues(state, 'slate', [HEADLINE])).toEqual({ headline: 'third' });
		expect(broadcastGraphicInputsState(state, 'slate').acceptedRevision).toBe(3);
	});

	it('discards a pending visual update on exit while keeping its accepted values', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = out(state, 'slate', false, T0 + 2100);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2200))).toBe('exiting');
		expect(acceptedGraphicInputValues(state, 'slate', [HEADLINE])).toEqual({ headline: 'second' });
		expect(rendered(state, T0 + 2200)).toEqual({ current: { headline: 'second' } });
	});

	it('shows a Cut Update immediately, without an update phase', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000, true);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2000))).toBe('on-air');
		expect(rendered(state, T0 + 2000)).toEqual({ current: { headline: 'second' } });
	});

	it('swaps a Cut Update during enter into the current animated state, keeping the enter schedule', () => {
		let state = taken();
		state = edit(state, 'second', T0 + 300);
		state = accept(state, T0 + 300, true);

		// The entrance carries on from where it was, on its original schedule.
		expect(state.playout.slate!.effectiveStartedAt).toBe(T0);
		expect(broadcastGraphicPhaseProjection(state, 'slate', at(T0 + 400)))
			.toEqual({ phase: 'enter', elapsed: 400 });
		// The new rendering is showing already, and nothing is left pending for it.
		expect(rendered(state, T0 + 400)).toEqual({ current: { headline: 'second' } });
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 1100))).toBe('on-air');
	});

	it('starts no update phase when the acceptance changes no rendered value', () => {
		let state = settledOnAir('first');
		state = accept(state, T0 + 2000);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2000))).toBe('on-air');
	});

	it('enters with the latest accepted values rather than updating, after an Out', () => {
		let state = settledOnAir('first');
		state = out(state, 'slate', false, T0 + 2000);
		state = edit(state, 'second', T0 + 3000);
		state = apply(state, { type: 'Take', payload: { graphicId: 'slate', cut: false } }, T0 + 4000);

		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 4100))).toBe('entering');
		expect(rendered(state, T0 + 4100)).toEqual({ current: { headline: 'second' } });
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 5100))).toBe('on-air');
	});

	it('settles a graphic whose update was accepted before a restart', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);

		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(state));
		const hoursLater = T0 + (4 * 60 * 60 * 1000);

		expect(broadcastGraphicPlayoutState(recovered, 'slate', at(hoursLater))).toBe('on-air');
		expect(broadcastGraphicPhaseProjection(recovered, 'slate', at(hoursLater))).toBeNull();
		expect(rendered(recovered, hoursLater)).toEqual({ current: { headline: 'second' } });
	});
});

describe('on-screen cycling on air', () => {
	function atCycling(now: number) {
		return { now, durations: TIMING, onScreen: true };
	}

	it('begins cycling when the entrance completes, and never stops the graphic being on air', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(broadcastGraphicPhaseProjection(state, 'slate', atCycling(T0 + 500)))
			.toEqual({ phase: 'enter', elapsed: 500 });
		expect(broadcastGraphicPhaseProjection(state, 'slate', atCycling(T0 + 1600)))
			.toEqual({ phase: 'on-screen', elapsed: 600 });
		expect(broadcastGraphicPlayoutState(state, 'slate', atCycling(T0 + 1600))).toBe('on-air');
	});

	it('begins cycling at once when the entrance was Cut', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);

		expect(broadcastGraphicPhaseProjection(state, 'slate', atCycling(T0 + 200)))
			.toEqual({ phase: 'on-screen', elapsed: 200 });
	});

	it('projects nothing for a graphic that authored no on-screen recipe', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(broadcastGraphicPhaseProjection(state, 'slate', at(T0 + 1600))).toBeNull();
	});
});
