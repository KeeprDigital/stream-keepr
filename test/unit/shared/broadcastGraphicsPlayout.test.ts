import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	acceptedGraphicInputValues,
	applyBroadcastGraphicsCommand,
	broadcastGraphicInputsState,
	broadcastGraphicPhaseProjections,
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

/** No Graphic Inputs: playout alone. Durations travel with acceptance, which decides whether an interrupted phase still runs. */
const NO_INPUTS = { inputs: [], durations: TIMING };

function take(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	cut = false,
	acceptedAt = T0,
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(
		state,
		{
			type: 'Take',
			payload: { graphicId, cut },
		},
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
		{
			type: 'Out',
			payload: { graphicId, cut },
		},
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
		expect(onAirBroadcastGraphicIds(state, [
			graphic('lower-third'),
		])).toEqual([]);
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
		const stack = [
			graphic('back'),
			graphic('middle'),
			graphic('front'),
		];
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'front');
		state = take(state, 'back');

		expect(onAirBroadcastGraphicIds(state, stack)).toEqual(['back', 'front']);
	});

	it('omits a Broadcast Graphic that is no longer in the authored stack', () => {
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'deleted');
		state = take(state, 'kept');

		expect(onAirBroadcastGraphicIds(state, [
			graphic('kept'),
		])).toEqual(['kept']);
	});
});

describe('the persisted playout shape, and the no-replay invariant it has to keep', () => {
	it('persists the accepted intent and one authoritative effective start time', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// The durable record is accepted intent plus the instant its phase began: no phase is
		// stored, so recovery has nothing to resume or replay (#64). Inputs and sources are
		// standing operator intent and replay nothing either.
		expect(Object.keys(persisted).toSorted()).toEqual(['inputs', 'playout', 'sources']);
		expect(Object.keys(persisted.playout.slate!).toSorted()).toEqual(['cut', 'effectiveStartedAt', 'onAir']);
		expect(persisted.playout.slate).toEqual({ onAir: true, effectiveStartedAt: T0, cut: false });
		expect(Object.keys(persisted.inputs.slate!).toSorted())
			.toEqual([
				'accepted',
				'acceptedRevision',
				'overrides',
				'working',
			]);
	});

	it('adds a scheduled reversal completion only to an intent that actually interrupted a phase', () => {
		// A reversal stores one scheduled completion instant, read literally with no clearing:
		// a stale read settles to the intent that wrote it, so nothing can replay (#69). A graphic
		// that was never interrupted stores no such field.
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversed = out(entering, 'slate', false, T0 + 300);

		expect(Object.keys(reversed.playout.slate!).toSorted())
			.toEqual([
				'cut',
				'effectiveStartedAt',
				'onAir',
				'reversalCompletesAt',
			]);
		expect(reversed.playout.slate).toEqual({
			onAir: false,
			effectiveStartedAt: T0 + 300,
			cut: false,
			reversalCompletesAt: T0 + 600,
		});

		// Read four hours late, with nothing having cleared or validated anything.
		const hoursLater = T0 + (4 * 60 * 60 * 1000);
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(hoursLater))).toBe('off');
		expect(broadcastGraphicPhaseProjections(reversed, 'slate', at(hoursLater))).toEqual([]);
	});

	it('adds an update phase start only while an update animation is still owed', () => {
		// An update stores its effective start; its length comes from Screen configuration and
		// the chain saturates once spent, so a read after a restart reports no update.
		const declaration: GraphicInputDeclaration = {
			key: 'headline',
			label: 'Headline',
			required: false,
			updatePolicy: 'staged',
			type: 'text',
			default: '',
			maxLength: 80,
		};
		const context = {
			inputs: [declaration],
			durations: TIMING,
		};
		let state = applyBroadcastGraphicsCommand(
			createInitialBroadcastGraphicsLiveState(),
			{
				type: 'Take',
				payload: { graphicId: 'slate', cut: false },
			},
			{ ...context, acceptedAt: T0 },
		);
		state = applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Set Input',
				payload: { graphicId: 'slate', inputKey: 'headline', value: 'next' },
			},
			{ ...context, acceptedAt: T0 + 2000 },
		);
		state = applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Update Graphic',
				payload: { graphicId: 'slate', cut: false, basedOnAcceptedRevision: 1 },
			},
			{ ...context, acceptedAt: T0 + 2000 },
		);

		expect(Object.keys(state.playout.slate!).toSorted())
			.toEqual([
				'cut',
				'effectiveStartedAt',
				'onAir',
				'updateStartedAt',
			]);
		// The outgoing rendering is stored beside the accepted values; there is never a second
		// pending one, because only one update is in flight.
		expect(Object.keys(state.inputs.slate!).toSorted())
			.toEqual([
				'accepted',
				'acceptedRevision',
				'overrides',
				'updateFrom',
				'working',
			]);

		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(state));
		const hoursLater = T0 + (4 * 60 * 60 * 1000);
		expect(broadcastGraphicPlayoutState(recovered, 'slate', at(hoursLater))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(recovered, 'slate', at(hoursLater))).toEqual([]);
		expect(broadcastGraphicRenderedInputs(recovered, 'slate', [declaration], at(hoursLater)))
			.toEqual({
				current: { headline: 'next' },
			});
	});

	it('stores no lifecycle phase, so there is nothing for recovery to resume', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate');
		const reversing = out(entering, 'slate', false, T0 + 300);

		for (const persisted of [entering, reversing]) {
			const serialized = JSON.stringify(persisted);
			for (const phase of [
				'waiting',
				'entering',
				'on-air',
				'updating',
				'exiting',
				'phase',
				'state',
			])
				expect(serialized).not.toContain(phase);
		}
	});

	it('recovers a target-on-air Broadcast Graphic settled at its Graphic Resting State', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// A reload, disconnect, or server restart reaches the reducer as nothing but
		// the JSON that was in the session's text column.
		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(persisted));

		expect(broadcastGraphicPlayoutState(recovered, 'slate')).toBe('on-air');
		expect(onAirBroadcastGraphicIds(recovered, [
			graphic('slate'),
		])).toEqual(['slate']);
	});

	it('settles a graphic taken before a restart rather than replaying its entrance', () => {
		// A graphic taken long ago must not fly back on after a crash.
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');
		const hoursLater = T0 + (4 * 60 * 60 * 1000);

		expect(broadcastGraphicPlayoutState(persisted, 'slate', at(hoursLater))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(persisted, 'slate', at(hoursLater))).toEqual([]);
	});

	it('catches a late-loading output up to the current phase instead of restarting it', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// An output that opens 400ms into a one-second enter joins 400ms in, and one
		// that opens after it joins settled. Neither starts from zero.
		expect(broadcastGraphicPhaseProjections(taken, 'slate', at(T0 + 400)))
			.toEqual([
				{ phase: 'enter', elapsed: 400 },
			]);
		expect(broadcastGraphicPhaseProjections(taken, 'slate', at(T0 + 1500))).toEqual([]);
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
		expect(broadcastGraphicPhaseProjections(duplicate, 'slate', at(T0 + 600)))
			.toEqual([
				{ phase: 'enter', elapsed: 600 },
			]);
	});

	it('starts a new phase when the intent actually changes', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const outed = out(taken, 'slate', false, T0 + 5000);

		expect(broadcastGraphicPhaseProjections(outed, 'slate', at(T0 + 5200)))
			.toEqual([
				{ phase: 'exit', elapsed: 200 },
			]);
	});

	it('never replays an entrance when a plain Take follows a Cut Take', () => {
		// A plain Take after a Cut Take reaches the same target, so it must not replay the entrance.
		const cut = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);
		const plain = take(cut, 'slate', false, T0 + 5000);

		expect(plain.playout.slate).toBe(cut.playout.slate);
		expect(broadcastGraphicPlayoutState(plain, 'slate', at(T0 + 5000))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(plain, 'slate', at(T0 + 5000))).toEqual([]);
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
		expect(onAirBroadcastGraphicIds(state, [
			graphic('slate'),
		], at(T0 + 5000))).toEqual([]);
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
		expect(broadcastGraphicPhaseProjections(recut, 'slate', at(T0 + 300))).toEqual([]);
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
		expect(broadcastGraphicPlayoutState(taken, 'slate', {
			now: T0,
			durations: { enter: 0 },
		})).toBe('on-air');
	});

	it('completes a Cut phase immediately, without changing the target it reaches', () => {
		const cut = take(createInitialBroadcastGraphicsLiveState(), 'slate', true);

		expect(broadcastGraphicPlayoutState(cut, 'slate', at(T0))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(cut, 'slate', at(T0))).toEqual([]);
	});

	it('keeps an exiting Broadcast Graphic on program until its exit completes', () => {
		// A graphic leaves the frame when its exit finishes, not when Out is accepted.
		const outed = out(take(createInitialBroadcastGraphicsLiveState(), 'slate'), 'slate', false, T0 + 5000);
		const stack = [
			graphic('slate'),
		];

		expect(onAirBroadcastGraphicIds(outed, stack, at(T0 + 5200))).toEqual(['slate']);
		expect(onAirBroadcastGraphicIds(outed, stack, at(T0 + 5600))).toEqual([]);
	});

	it('composes an entering Broadcast Graphic, in authored stack order', () => {
		let state = createInitialBroadcastGraphicsLiveState();
		state = take(state, 'front', false, T0);
		state = take(state, 'back', false, T0 + 100);

		expect(onAirBroadcastGraphicIds(state, [
			graphic('back'),
			graphic('front'),
		], at(T0 + 200)))
			.toEqual(['back', 'front']);
	});

	it('never projects a negative elapsed time from a start time in the future', () => {
		// Client clocks drift from the server's, so a snapshot can arrive with a start
		// time slightly ahead of the reader's own clock.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0 + 40);

		expect(broadcastGraphicPhaseProjections(taken, 'slate', at(T0))).toEqual([
			{ phase: 'enter', elapsed: 0 },
		]);
	});
});

describe('the clock an output does not own', () => {
	// A start time in the future means the reader's clock is behind; both its sign and its
	// magnitude must be bounded.

	it('leaves an Out Broadcast Graphic on program for no longer than its exit lasts', () => {
		// A minute-slow browser must not hold an exiting graphic on program for that minute.
		const outed = out(take(createInitialBroadcastGraphicsLiveState(), 'slate'), 'slate', false, T0 + 5000);
		const minuteBehind = T0 + 5000 - 60_000;

		expect(broadcastGraphicPlayoutState(outed, 'slate', at(minuteBehind))).toBe('off');
		expect(onAirBroadcastGraphicIds(outed, [
			graphic('slate'),
		], at(minuteBehind))).toEqual([]);
	});

	it('settles rather than pinning an entrance when the reader is further behind than the phase lasts', () => {
		// On the way on air, an unbounded skew would replay the entrance through the clock.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(broadcastGraphicPlayoutState(taken, 'slate', at(T0 - 30_000))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(taken, 'slate', at(T0 - 30_000))).toEqual([]);
	});

	it('projects nothing at all for a reader with no instant it trusts', () => {
		// With no authoritative instant a reader settles every graphic to its intended state
		// rather than guessing on its own clock.
		let state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		state = out(state, 'slate', false, T0 + 300);

		expect(broadcastGraphicPhaseProjections(state, 'slate')).toEqual([]);
		expect(broadcastGraphicPlayoutState(state, 'slate')).toBe('off');
		expect(onAirBroadcastGraphicIds(state, [
			graphic('slate'),
		])).toEqual([]);
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
		expect(broadcastGraphicPhaseProjections(reversed, 'slate', at(T0 + 300)))
			.toEqual([
				{ phase: 'enter', elapsed: 300 },
			]);
		expect(broadcastGraphicPhaseProjections(reversed, 'slate', at(T0 + 400)))
			.toEqual([
				{ phase: 'enter', elapsed: 200 },
			]);
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 400))).toBe('exiting');

		// And it is off the moment the reversal lands, not a frame later.
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 600))).toBe('off');
		expect(broadcastGraphicPhaseProjections(reversed, 'slate', at(T0 + 600))).toEqual([]);
	});

	it('reverses an exit when Take interrupts it', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		state = out(state, 'slate', false, T0 + 5000);
		const reversed = take(state, 'slate', false, T0 + 5200);

		// 200ms into a half-second exit: the exit unwinds over 200ms and the graphic is
		// back at its Graphic Resting State, on air, without playing an entrance.
		expect(broadcastGraphicPhaseProjections(reversed, 'slate', at(T0 + 5200)))
			.toEqual([
				{ phase: 'exit', elapsed: 200 },
			]);
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 5300))).toBe('entering');
		expect(broadcastGraphicPlayoutState(reversed, 'slate', at(T0 + 5400))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(reversed, 'slate', at(T0 + 5400))).toEqual([]);
	});

	it('resumes the interrupted phase forwards when the operator changes their mind twice', () => {
		const entering = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const reversing = out(entering, 'slate', false, T0 + 400);
		// 100ms into unwinding, so 300ms of the entrance is still rendered.
		const resumed = take(reversing, 'slate', false, T0 + 500);

		expect(broadcastGraphicPhaseProjections(resumed, 'slate', at(T0 + 500)))
			.toEqual([
				{ phase: 'enter', elapsed: 300 },
			]);
		// It runs on from there rather than restarting: 300ms rendered plus 200ms more.
		expect(broadcastGraphicPhaseProjections(resumed, 'slate', at(T0 + 700)))
			.toEqual([
				{ phase: 'enter', elapsed: 500 },
			]);
		expect(broadcastGraphicPlayoutState(resumed, 'slate', at(T0 + 1200))).toBe('on-air');
	});

	it('does not reverse a phase that had already completed', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const outed = out(taken, 'slate', false, T0 + 5000);

		expect(outed.playout.slate).toEqual({ onAir: false, effectiveStartedAt: T0 + 5000, cut: false });
		expect(broadcastGraphicPhaseProjections(outed, 'slate', at(T0 + 5100)))
			.toEqual([
				{ phase: 'exit', elapsed: 100 },
			]);
	});

	it('does not reverse a Cut phase, because a Cut phase was never in flight', () => {
		const cut = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);
		const outed = out(cut, 'slate', false, T0 + 100);

		expect(outed.playout.slate!.reversalCompletesAt).toBeUndefined();
		expect(broadcastGraphicPhaseProjections(outed, 'slate', at(T0 + 200)))
			.toEqual([
				{ phase: 'exit', elapsed: 100 },
			]);
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
		const stack = [
			graphic('slate'),
		];

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

	const CONTEXT = {
		inputs: [HEADLINE],
		durations: TIMING,
	};

	function apply(
		state: BroadcastGraphicsLiveState,
		command: Parameters<typeof applyBroadcastGraphicsCommand>[1],
		acceptedAt: number,
	): BroadcastGraphicsLiveState {
		return applyBroadcastGraphicsCommand(state, command, { ...CONTEXT, acceptedAt });
	}

	function edit(state: BroadcastGraphicsLiveState, value: string, acceptedAt: number) {
		return apply(state, {
			type: 'Set Input',
			payload: { graphicId: 'slate', inputKey: 'headline', value },
		}, acceptedAt);
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
		return apply(createInitialBroadcastGraphicsLiveState(), {
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}, acceptedAt);
	}

	function rendered(state: BroadcastGraphicsLiveState, now: number) {
		return broadcastGraphicRenderedInputs(state, 'slate', [HEADLINE], at(now));
	}

	/** On air and settled: enter is over, nothing pending. */
	function settledOnAir(headline: string) {
		let state = edit(createInitialBroadcastGraphicsLiveState(), headline, T0 - 10);
		state = apply(state, {
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}, T0);
		return state;
	}

	it('reports updating for the length of the update phase, then on-air again', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);

		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2000))).toBe('updating');
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2399))).toBe('updating');
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2400))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 2100)))
			.toEqual([
				{ phase: 'update', elapsed: 100 },
			]);
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
		expect(rendered(state, T0 + 2400)).toEqual({
			current: { headline: 'second' },
		});
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
		expect(rendered(state, T0 + 300)).toEqual({
			current: { headline: '' },
		});

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
		expect(rendered(state, T0 + 2800)).toEqual({
			current: { headline: 'fourth' },
		});
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

	it('lets the transition still crossing finish beneath the exit, keeping its accepted values', () => {
		// Exit discards the pending update but lets the running one finish beneath it, so both
		// phases are in play at once (CONTEXT.md, Broadcast Graphic exit).
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = out(state, 'slate', false, T0 + 2100);

		// The schedule is the one the acceptance wrote, untouched: the Out did not restart
		// the transition, and did not move it.
		expect(state.playout.slate!.updateStartedAt).toBe(T0 + 2000);
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2200))).toBe('exiting');
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 2200))).toEqual([
			{ phase: 'update', elapsed: 200 },
			{ phase: 'exit', elapsed: 100 },
		]);
		expect(rendered(state, T0 + 2200)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: 'first' },
		});

		// The update completes on its own schedule while the exit carries on.
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 2450)))
			.toEqual([
				{ phase: 'exit', elapsed: 350 },
			]);
		expect(rendered(state, T0 + 2450)).toEqual({
			current: { headline: 'second' },
		});
		expect(acceptedGraphicInputValues(state, 'slate', [HEADLINE])).toEqual({ headline: 'second' });
	});

	it('discards the rendering pending behind the transition it lets finish', () => {
		// Exit keeps the running transition and drops the queued rendering.
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = edit(state, 'third', T0 + 2100);
		state = accept(state, T0 + 2100);
		state = out(state, 'slate', false, T0 + 2200);

		// The running transition is still 'first' to 'second', not retargeted to the values
		// accepted behind it.
		expect(rendered(state, T0 + 2300)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: 'first' },
		});
		// And nothing hands over to the pending rendering when it completes.
		expect(rendered(state, T0 + 2500)).toEqual({
			current: { headline: 'second' },
		});
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 2500)))
			.toEqual([
				{ phase: 'exit', elapsed: 300 },
			]);
		// Interrupting an update never rolls back what it accepted.
		expect(acceptedGraphicInputValues(state, 'slate', [HEADLINE])).toEqual({ headline: 'third' });
	});

	it('keeps the transition still crossing when a Take reverses the exit it was running under', () => {
		// Take during exit reverses from the half-crossed pair on program, not a snap.
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = out(state, 'slate', false, T0 + 2100);
		state = apply(state, {
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}, T0 + 2200);

		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 2200))).toEqual([
			{ phase: 'update', elapsed: 200 },
			{ phase: 'exit', elapsed: 100 },
		]);
		expect(rendered(state, T0 + 2200)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: 'first' },
		});
		// The transition keeps its own schedule across the take-over, exactly as the
		// cycling origin does.
		expect(state.playout.slate!.updateStartedAt).toBe(T0 + 2000);
	});

	it('resumes the update the exit discarded, once a Take makes the graphic on air again', () => {
		// After Take-during-exit, program reaches the accepted values through the update recipe
		// rather than snapping to them.
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = edit(state, 'third', T0 + 2100);
		state = accept(state, T0 + 2100);
		state = out(state, 'slate', false, T0 + 2200);
		state = apply(state, {
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}, T0 + 2300);

		// The transition the exit kept finishes first, on the schedule it always had.
		expect(rendered(state, T0 + 2300)).toEqual({
			current: { headline: 'second' },
			outgoing: { headline: 'first' },
		});
		// Then the one it had discarded, because the graphic is on air again.
		expect(rendered(state, T0 + 2500)).toEqual({
			current: { headline: 'third' },
			outgoing: { headline: 'second' },
		});
		expect(rendered(state, T0 + 2900)).toEqual({
			current: { headline: 'third' },
		});
	});

	it('holds the discarded rendering only until the graphic leaves', () => {
		// While leaving, program keeps the interrupted update's target; once off, the accepted
		// set is what the next Take enters with.
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = edit(state, 'third', T0 + 2100);
		state = accept(state, T0 + 2100);
		state = out(state, 'slate', false, T0 + 2200);

		expect(rendered(state, T0 + 2500)).toEqual({
			current: { headline: 'second' },
		});
		expect(rendered(state, T0 + 2700)).toEqual({
			current: { headline: 'third' },
		});
	});

	it('discards an update that had not begun, because there is no transition to finish', () => {
		// An acceptance during an entrance is deferred to the entrance's completion, so an
		// Out before that completion interrupts nothing: there is no pair being crossed,
		// and carrying the schedule would start a transition on a graphic already leaving.
		let state = taken();
		state = edit(state, 'second', T0 + 100);
		state = accept(state, T0 + 100);
		state = out(state, 'slate', false, T0 + 300);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 400)))
			.toEqual([
				{ phase: 'enter', elapsed: 200 },
			]);
		expect(rendered(state, T0 + 1200)).toEqual({
			current: { headline: 'second' },
		});
	});

	it('carries nothing out of a Cut Out, because nothing renders an animation that was skipped', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = out(state, 'slate', true, T0 + 2100);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 2100))).toEqual([]);
		expect(rendered(state, T0 + 2100)).toEqual({
			current: { headline: 'second' },
		});
	});

	it('settles both concurrent phases after a restart, without replaying either', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = out(state, 'slate', false, T0 + 2100);

		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(state));
		const hoursLater = T0 + (4 * 60 * 60 * 1000);

		expect(broadcastGraphicPlayoutState(recovered, 'slate', at(hoursLater))).toBe('off');
		expect(broadcastGraphicPhaseProjections(recovered, 'slate', at(hoursLater))).toEqual([]);
		expect(onAirBroadcastGraphicIds(recovered, [
			graphic('slate'),
		], at(hoursLater))).toEqual([]);
	});

	it('never carries a stale pending rendering into a later update', () => {
		// An acceptance with no pending rendering must clear the previous one.
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);
		state = edit(state, 'third', T0 + 2100);
		state = accept(state, T0 + 2100);

		// Both transitions are long over before this one is accepted.
		state = edit(state, 'fourth', T0 + 5000);
		state = accept(state, T0 + 5000);

		expect(rendered(state, T0 + 5200)).toEqual({
			current: { headline: 'fourth' },
			outgoing: { headline: 'third' },
		});
		expect(rendered(state, T0 + 5400)).toEqual({
			current: { headline: 'fourth' },
		});
	});

	it('shows a Cut Update immediately, without an update phase', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000, true);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2000))).toBe('on-air');
		expect(rendered(state, T0 + 2000)).toEqual({
			current: { headline: 'second' },
		});
	});

	it('swaps a Cut Update during enter into the current animated state, keeping the enter schedule', () => {
		let state = taken();
		state = edit(state, 'second', T0 + 300);
		state = accept(state, T0 + 300, true);

		// The entrance carries on from where it was, on its original schedule.
		expect(state.playout.slate!.effectiveStartedAt).toBe(T0);
		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 400)))
			.toEqual([
				{ phase: 'enter', elapsed: 400 },
			]);
		// The new rendering is showing already, and nothing is left pending for it.
		expect(rendered(state, T0 + 400)).toEqual({
			current: { headline: 'second' },
		});
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 1100))).toBe('on-air');
	});

	it('starts no update phase when the acceptance changes no accepted value', () => {
		// Only accepted values decide; whether a change is rendered is the compositor's question.
		let state = settledOnAir('first');
		state = accept(state, T0 + 2000);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 2000))).toBe('on-air');
	});

	it('bounds a deferred update by the entrance it waits for, not by the reader\'s clock', () => {
		// An update start further ahead than one entrance is a slow reader clock, and is bounded.
		let state = taken();
		state = edit(state, 'second', T0 + 100);
		state = accept(state, T0 + 100);

		// Deferred to T0 + 1000. A reader half a minute behind cannot still be waiting.
		expect(rendered(state, T0 + 500)).toEqual({
			current: { headline: '' },
		});
		expect(rendered(state, T0 - 30_000)).toEqual({
			current: { headline: 'second' },
		});
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 - 30_000))).toBe('on-air');
	});

	it('abandons a running update when a live Graphic Input is applied immediately', () => {
		// A live update supersedes a running cross-transition rather than retargeting it mid-way.
		const live: GraphicInputDeclaration = { ...HEADLINE, key: 'ticker', updatePolicy: 'live' };
		const context = {
			inputs: [HEADLINE, live],
			durations: TIMING,
		};
		let state = applyBroadcastGraphicsCommand(
			createInitialBroadcastGraphicsLiveState(),
			{
				type: 'Take',
				payload: { graphicId: 'slate', cut: false },
			},
			{ ...context, acceptedAt: T0 },
		);
		state = applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Set Input',
				payload: { graphicId: 'slate', inputKey: 'headline', value: 'second' },
			},
			{ ...context, acceptedAt: T0 + 2000 },
		);
		state = applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Update Graphic',
				payload: { graphicId: 'slate', cut: false, basedOnAcceptedRevision: 1 },
			},
			{ ...context, acceptedAt: T0 + 2000 },
		);
		expect(state.playout.slate!.updateStartedAt).toBe(T0 + 2000);

		state = applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Set Input',
				payload: { graphicId: 'slate', inputKey: 'ticker', value: 'now' },
			},
			{ ...context, acceptedAt: T0 + 2100 },
		);

		expect(state.playout.slate!.updateStartedAt).toBeUndefined();
		expect(broadcastGraphicRenderedInputs(state, 'slate', [HEADLINE, live], at(T0 + 2100)))
			.toEqual({
				current: { headline: 'second', ticker: 'now' },
			});
		// A live acceptance still does not count as an acceptance of the staged set, so a
		// colleague's pending Update Graphic is not invalidated by it.
		expect(broadcastGraphicInputsState(state, 'slate').acceptedRevision).toBe(2);
	});

	it('enters with the latest accepted values rather than updating, after an Out', () => {
		let state = settledOnAir('first');
		state = out(state, 'slate', false, T0 + 2000);
		state = edit(state, 'second', T0 + 3000);
		state = apply(state, {
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}, T0 + 4000);

		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 4100))).toBe('entering');
		expect(rendered(state, T0 + 4100)).toEqual({
			current: { headline: 'second' },
		});
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 5100))).toBe('on-air');
	});

	it('settles a graphic whose update was accepted before a restart', () => {
		let state = settledOnAir('first');
		state = edit(state, 'second', T0 + 2000);
		state = accept(state, T0 + 2000);

		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(state));
		const hoursLater = T0 + (4 * 60 * 60 * 1000);

		expect(broadcastGraphicPlayoutState(recovered, 'slate', at(hoursLater))).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(recovered, 'slate', at(hoursLater))).toEqual([]);
		expect(rendered(recovered, hoursLater)).toEqual({
			current: { headline: 'second' },
		});
	});
});

describe('on-screen cycling on air', () => {
	function atCycling(now: number) {
		return { now, durations: TIMING, onScreen: true };
	}

	it('begins cycling when the entrance completes, and never stops the graphic being on air', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 500)))
			.toEqual([
				{ phase: 'enter', elapsed: 500 },
			]);
		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 1600)))
			.toEqual([
				{ phase: 'on-screen', elapsed: 600 },
			]);
		expect(broadcastGraphicPlayoutState(state, 'slate', atCycling(T0 + 1600))).toBe('on-air');
	});

	it('begins cycling at once when the entrance was Cut', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'slate', true, T0);

		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 200)))
			.toEqual([
				{ phase: 'on-screen', elapsed: 200 },
			]);
	});

	it('projects nothing for a graphic that authored no on-screen recipe', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(broadcastGraphicPhaseProjections(state, 'slate', at(T0 + 1600))).toEqual([]);
	});

	/** An Out from a Broadcast Graphic whose author enabled on-screen cycling. */
	function outCycling(state: BroadcastGraphicsLiveState, acceptedAt: number, cut = false) {
		return applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Out',
				payload: { graphicId: 'slate', cut },
			},
			{
				inputs: [],
				durations: TIMING,
				onScreen: true,
				acceptedAt,
			},
		);
	}

	it('continues from the excursion that was rendered when exit interrupts cycling', () => {
		// Exit composes over the cycle, so its first frame is the frame already on screen.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const state = outCycling(taken, T0 + 2500);

		// 1500ms into cycling, which began when the one-second entrance settled.
		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 2500))).toEqual([
			{ phase: 'on-screen', elapsed: 1500 },
			{ phase: 'exit', elapsed: 0 },
		]);
		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 2600))).toEqual([
			{ phase: 'on-screen', elapsed: 1600 },
			{ phase: 'exit', elapsed: 100 },
		]);
		expect(broadcastGraphicPlayoutState(state, 'slate', atCycling(T0 + 2600))).toBe('exiting');
	});

	it('stops projecting cycling when the exit it was running under completes', () => {
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const state = outCycling(taken, T0 + 2500);

		// The graphic left the frame when its exit completed, so there is nothing left for
		// a cycle to be rendered onto — and a reader four hours late agrees, with nothing
		// having cleared the origin it is reading.
		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 3000))).toEqual([]);
		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + (4 * 60 * 60 * 1000))))
			.toEqual([]);
		expect(onAirBroadcastGraphicIds(state, [
			graphic('slate'),
		], atCycling(T0 + 3000))).toEqual([]);
	});

	it('keeps cycling running when a Take reverses the exit it was running under', () => {
		// Take during exit keeps the cycle's excursion rather than snapping it to rest.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);
		const exiting = outCycling(taken, T0 + 2500);
		const state = take(exiting, 'slate', false, T0 + 2600);

		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 2600))).toEqual([
			{ phase: 'on-screen', elapsed: 1600 },
			{ phase: 'exit', elapsed: 100 },
		]);
		// And it runs on from the same origin once the reversal lands, rather than
		// restarting the cycle from its beginning.
		expect(broadcastGraphicPhaseProjections(state, 'slate', atCycling(T0 + 2800)))
			.toEqual([
				{ phase: 'on-screen', elapsed: 1800 },
			]);
	});

	it('grows the durable record only for a graphic that was actually cycling', () => {
		// An Out that interrupted no cycle stores only what an Out always stored.
		const taken = take(createInitialBroadcastGraphicsLiveState(), 'slate', false, T0);

		expect(Object.keys(outCycling(taken, T0 + 300).playout.slate!).toSorted())
			.toEqual([
				'cut',
				'effectiveStartedAt',
				'onAir',
				'reversalCompletesAt',
			]);
		expect(Object.keys(out(taken, 'slate', false, T0 + 2500).playout.slate!).toSorted())
			.toEqual(['cut', 'effectiveStartedAt', 'onAir']);
		expect(Object.keys(outCycling(taken, T0 + 2500).playout.slate!).toSorted())
			.toEqual([
				'cut',
				'cyclingStartedAt',
				'effectiveStartedAt',
				'onAir',
			]);
	});
});

describe('the bound on how many lifecycle phases are in play at once', () => {
	it('projects at most one content phase and one enter/exit phase', () => {
		// At most two phases overlap: exit over one content phase. Enter and on-screen, and update
		// and on-screen, exclude each other.
		const declaration: GraphicInputDeclaration = {
			key: 'headline',
			label: 'Headline',
			required: false,
			updatePolicy: 'staged',
			type: 'text',
			default: '',
			maxLength: 80,
		};
		const context = {
			inputs: [declaration],
			durations: TIMING,
			onScreen: true,
		};
		const apply = (
			state: BroadcastGraphicsLiveState,
			command: Parameters<typeof applyBroadcastGraphicsCommand>[1],
			acceptedAt: number,
		) => applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt });

		let state = apply(createInitialBroadcastGraphicsLiveState(), {
			type: 'Take',
			payload: { graphicId: 'slate' },
		}, T0);
		state = apply(state, {
			type: 'Set Input',
			payload: { graphicId: 'slate', inputKey: 'headline', value: 'next' },
		}, T0 + 2000);
		state = apply(state, {
			type: 'Update Graphic',
			payload: { graphicId: 'slate', basedOnAcceptedRevision: 1 },
		}, T0 + 2000);
		state = apply(state, {
			type: 'Out',
			payload: { graphicId: 'slate' },
		}, T0 + 2100);

		// The whole lifecycle of that graphic, sampled every 50ms across every phase it can
		// reach, on a Screen that authored all four.
		for (let now = T0 - 500; now <= T0 + 4000; now += 50) {
			const projected = broadcastGraphicPhaseProjections(state, 'slate', { now, durations: TIMING, onScreen: true });
			expect(projected.length).toBeLessThanOrEqual(2);
			expect(projected.filter(entry => entry.phase === 'update' || entry.phase === 'on-screen').length)
				.toBeLessThanOrEqual(1);
			expect(projected.filter(entry => entry.phase === 'enter' || entry.phase === 'exit').length)
				.toBeLessThanOrEqual(1);
			// The content phase composes innermost, so it is always stated first.
			if (projected.length === 2)
				expect(['update', 'on-screen']).toContain(projected[0]!.phase);
		}
	});
});
