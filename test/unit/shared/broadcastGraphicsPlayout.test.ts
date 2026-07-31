import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	broadcastGraphicPhaseProjection,
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';

/** A fixed authoritative clock, so nothing here depends on wall time. */
const T0 = 1_700_000_000_000;

function graphic(id: string): BroadcastGraphicConfig {
	return { id, name: id, items: [] };
}

/** A Broadcast Graphic declaring no Graphic Inputs: playout alone. */
const NO_INPUTS = { inputs: [] };

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

/** A one-second enter and a half-second exit, which is a plausible authored pair. */
const TIMING = { enter: 1000, exit: 500 };

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
		// Graphic Source Selections and Graphic Input Overrides join the accepted values
		// on the same terms: both are standing operator intent that outlives a hide/show
		// cycle, and neither says anything about a lifecycle phase, so neither gives
		// recovery anything to replay.
		expect(Object.keys(persisted).toSorted()).toEqual(['inputs', 'playout', 'sources']);
		expect(Object.keys(persisted.playout.slate!).toSorted()).toEqual(['cut', 'effectiveStartedAt', 'onAir']);
		expect(persisted.playout.slate).toEqual({ onAir: true, effectiveStartedAt: T0, cut: false });
		expect(Object.keys(persisted.inputs.slate!).toSorted())
			.toEqual(['accepted', 'acceptedRevision', 'overrides', 'working']);
	});

	it('stores no lifecycle phase, so there is nothing for recovery to resume', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');
		const serialized = JSON.stringify(persisted);

		for (const phase of ['waiting', 'entering', 'on-air', 'updating', 'exiting', 'phase', 'state'])
			expect(serialized).not.toContain(phase);
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
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0 + 5000);

		expect(broadcastGraphicPhaseProjection(taken, 'slate', at(T0))).toEqual({ phase: 'enter', elapsed: 0 });
	});
});
