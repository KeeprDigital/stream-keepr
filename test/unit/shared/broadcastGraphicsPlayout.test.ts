import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsPlayoutCommand,
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';

function graphic(id: string): BroadcastGraphicConfig {
	return { id, name: id, items: [] };
}

function take(state: BroadcastGraphicsLiveState, graphicId: string, cut = false): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsPlayoutCommand(state, 'Take', { graphicId, cut });
}

function out(state: BroadcastGraphicsLiveState, graphicId: string, cut = false): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsPlayoutCommand(state, 'Out', { graphicId, cut });
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

	it('reaches the same target state whether or not the action was Cut', () => {
		const initial = createInitialBroadcastGraphicsLiveState();

		expect(take(initial, 'slate', true)).toEqual(take(initial, 'slate', false));
		expect(out(take(initial, 'slate'), 'slate', true)).toEqual(out(take(initial, 'slate'), 'slate', false));
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

	it('recovers a target-on-air Broadcast Graphic settled on air rather than entering', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// A reload, disconnect, or server restart reaches the reducer as nothing but
		// the JSON that was in the session's text column.
		const recovered: BroadcastGraphicsLiveState = JSON.parse(JSON.stringify(persisted));

		expect(broadcastGraphicPlayoutState(recovered, 'slate')).toBe('on-air');
		expect(onAirBroadcastGraphicIds(recovered, [graphic('slate')])).toEqual(['slate']);
	});

	it('persists the accepted intent and nothing that could replay animation', () => {
		const persisted = take(createInitialBroadcastGraphicsLiveState(), 'slate');

		// The guarantee that recovery settles at the Graphic Resting State holds
		// because no lifecycle phase or phase start time is stored — there is
		// nothing for recovery to resume. That is a property of the persisted shape,
		// so it is asserted as one: adding a field here (a phase, an effective start
		// time) must fail this test and force a conscious decision about whether
		// recovery would replay it.
		expect(Object.keys(persisted).toSorted()).toEqual(['playout']);
		expect(Object.keys(persisted.playout.slate!).toSorted()).toEqual(['onAir']);
	});
});
