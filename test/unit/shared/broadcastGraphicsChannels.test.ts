import type {
	BroadcastGraphicChannelContext,
	BroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicChannelHandoffPolicy } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	broadcastGraphicChannelContexts,
	broadcastGraphicInputsState,
	broadcastGraphicPhaseProjections,
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { graphicChannelGroups, graphicChannelHandoffPolicy } from '~~/shared/modules/graphics';

/** A fixed authoritative clock, so nothing here depends on wall time. */
const T0 = 1_700_000_000_000;

/** A one-second enter, a half-second exit, and a 400ms update: a plausible authored set. */
const TIMING = { enter: 1000, exit: 500, update: 400 };

function graphic(id: string, channelId?: string): BroadcastGraphicConfig {
	return { id, name: id, items: [], ...(channelId ? { channelId } : {}) };
}

/**
 * The channel context every member of one Graphic Channel is read and reduced
 * against, with one authored phase set shared by all of them.
 */
function channel(
	handoff: GraphicChannelHandoffPolicy,
	...graphicIds: string[]
): BroadcastGraphicChannelContext {
	return { handoff, members: graphicIds.map(graphicId => ({ graphicId, durations: TIMING })) };
}

const LOWER_THIRDS = channel('overlap', 'alpha', 'bravo', 'charlie');
const QUEUED_THIRDS = channel('out-then-in', 'alpha', 'bravo', 'charlie');

function take(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	options: { cut?: boolean; at?: number; channel?: BroadcastGraphicChannelContext } = {},
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(
		state,
		{ type: 'Take', payload: { graphicId, cut: options.cut === true } },
		{
			inputs: [],
			durations: TIMING,
			acceptedAt: options.at ?? T0,
			...(options.channel ? { channel: options.channel } : {}),
		},
	);
}

function out(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	options: { cut?: boolean; at?: number; channel?: BroadcastGraphicChannelContext } = {},
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(
		state,
		{ type: 'Out', payload: { graphicId, cut: options.cut === true } },
		{
			inputs: [],
			durations: TIMING,
			acceptedAt: options.at ?? T0,
			...(options.channel ? { channel: options.channel } : {}),
		},
	);
}

/** What one member's own reader sees at `now`, given the channel it belongs to. */
function at(now: number, context?: BroadcastGraphicChannelContext) {
	return { now, durations: TIMING, ...(context ? { channel: context } : {}) };
}

function stateOf(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	now: number,
	context: BroadcastGraphicChannelContext,
) {
	return broadcastGraphicPlayoutState(state, graphicId, at(now, context));
}

/** Which Broadcast Graphics compose into the frame, every member timed against its channel. */
function onAir(
	state: BroadcastGraphicsLiveState,
	graphics: readonly BroadcastGraphicConfig[],
	now: number,
	context?: BroadcastGraphicChannelContext,
): string[] {
	return onAirBroadcastGraphicIds(state, graphics, () => at(now, context));
}

describe('a Graphic Channel holds at most one Broadcast Graphic on air', () => {
	it('replaces the channel\'s on-air Broadcast Graphic when another member is taken', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });

		// The outgoing graphic is still on program until its exit completes, and settled
		// off once it has.
		expect(stateOf(state, 'alpha', T0 + 5200, LOWER_THIRDS)).toBe('exiting');
		expect(stateOf(state, 'bravo', T0 + 5200, LOWER_THIRDS)).toBe('entering');
		expect(stateOf(state, 'alpha', T0 + 5600, LOWER_THIRDS)).toBe('off');
		expect(stateOf(state, 'bravo', T0 + 6100, LOWER_THIRDS)).toBe('on-air');
	});

	it('leaves Broadcast Graphics in another Graphic Channel or in none running concurrently', () => {
		const bug = channel('overlap', 'bug');
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bug', { channel: bug });
		// A graphic in no channel is reduced with no channel context at all.
		state = take(state, 'slate');
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });

		expect(broadcastGraphicPlayoutState(state, 'bug', at(T0 + 6100, bug))).toBe('on-air');
		expect(broadcastGraphicPlayoutState(state, 'slate', at(T0 + 6100))).toBe('on-air');
		expect(stateOf(state, 'alpha', T0 + 6100, LOWER_THIRDS)).toBe('off');
	});

	it('never lets Graphic Channel membership or take timing change Screen stack order', () => {
		// Authored back to front: a channel member sits between two graphics in no channel.
		const stack = [graphic('slate'), graphic('bravo', 'thirds'), graphic('bug')];
		let state = take(createInitialBroadcastGraphicsLiveState(), 'bug');
		state = take(state, 'bravo', { channel: QUEUED_THIRDS });
		state = take(state, 'slate', { at: T0 + 10 });

		expect(onAir(state, stack, T0 + 2000, QUEUED_THIRDS)).toEqual(['slate', 'bravo', 'bug']);
	});

	it('is idempotent: a repeated Take neither restarts the newcomer nor disturbs the graphic it is replacing', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		const once = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });
		state = take(once, 'bravo', { at: T0 + 5200, channel: LOWER_THIRDS });

		expect(state).toEqual(once);
		// The outgoing graphic's exit is still running on its original schedule, rather
		// than having been cut off by a duplicate delivery of the Take that started it.
		expect(stateOf(state, 'alpha', T0 + 5300, LOWER_THIRDS)).toBe('exiting');
	});
});

describe('the Overlap Graphic Channel Handoff Policy', () => {
	it('begins the outgoing exit and the incoming enter at the same logical instant', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });

		expect(broadcastGraphicPhaseProjections(state, 'alpha', at(T0 + 5000, LOWER_THIRDS)))
			.toEqual([{ phase: 'exit', elapsed: 0 }]);
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5000, LOWER_THIRDS)))
			.toEqual([{ phase: 'enter', elapsed: 0 }]);
	});

	it('skips the waiting Graphic Playout State entirely', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });

		expect(stateOf(state, 'bravo', T0 + 5000, LOWER_THIRDS)).toBe('entering');
		expect(onAir(state, [graphic('alpha', 'thirds'), graphic('bravo', 'thirds')], T0 + 5100, LOWER_THIRDS))
			.toEqual(['alpha', 'bravo']);
	});

	it('reverses the current incoming graphic into exit and cuts off the older outgoing one', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });
		// 300ms into bravo's entrance and alpha's exit, a third graphic is taken.
		state = take(state, 'charlie', { at: T0 + 5300, channel: LOWER_THIRDS });

		// The current incoming graphic reverses from where it had reached, so it clears in
		// the 300ms it had taken to get there.
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5400, LOWER_THIRDS)))
			.toEqual([{ phase: 'enter', elapsed: 200 }]);
		expect(stateOf(state, 'bravo', T0 + 5400, LOWER_THIRDS)).toBe('exiting');
		expect(stateOf(state, 'bravo', T0 + 5600, LOWER_THIRDS)).toBe('off');

		// The older outgoing graphic is cut off at once rather than being left to finish an
		// exit nothing is handing over to any more.
		expect(stateOf(state, 'alpha', T0 + 5300, LOWER_THIRDS)).toBe('off');
		expect(broadcastGraphicPhaseProjections(state, 'alpha', at(T0 + 5300, LOWER_THIRDS))).toEqual([]);

		expect(stateOf(state, 'charlie', T0 + 5300, LOWER_THIRDS)).toBe('entering');
	});

	it('never queues an earlier Take: only the latest selected Broadcast Graphic enters', () => {
		const stack = [graphic('alpha', 'thirds'), graphic('bravo', 'thirds'), graphic('charlie', 'thirds')];
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });
		state = take(state, 'charlie', { at: T0 + 5300, channel: LOWER_THIRDS });

		// Long after every exit could have finished, the channel holds exactly one graphic.
		expect(onAir(state, stack, T0 + 20_000, LOWER_THIRDS)).toEqual(['charlie']);
	});
});

describe('the Out then in Graphic Channel Handoff Policy', () => {
	const stack = [graphic('alpha', 'thirds'), graphic('bravo', 'thirds'), graphic('charlie', 'thirds')];

	it('holds the incoming graphic waiting, absent from every output, until the outgoing exit completes', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		expect(stateOf(state, 'bravo', T0 + 5000, QUEUED_THIRDS)).toBe('waiting');
		expect(stateOf(state, 'bravo', T0 + 5499, QUEUED_THIRDS)).toBe('waiting');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5200, QUEUED_THIRDS))).toEqual([]);
		expect(onAir(state, stack, T0 + 5200, QUEUED_THIRDS)).toEqual(['alpha']);
	});

	it('begins the incoming enter at the outgoing exit\'s authoritative scheduled completion', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		// alpha's exit lasts 500ms, so bravo's entrance starts at exactly T0 + 5500.
		expect(stateOf(state, 'alpha', T0 + 5500, QUEUED_THIRDS)).toBe('off');
		expect(stateOf(state, 'bravo', T0 + 5500, QUEUED_THIRDS)).toBe('entering');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5500, QUEUED_THIRDS)))
			.toEqual([{ phase: 'enter', elapsed: 0 }]);
		expect(onAir(state, stack, T0 + 5600, QUEUED_THIRDS)).toEqual(['bravo']);
		expect(stateOf(state, 'bravo', T0 + 6500, QUEUED_THIRDS)).toBe('on-air');
	});

	it('replaces a waiting graphic before it enters while the current outgoing graphic finishes normally', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });
		state = take(state, 'charlie', { at: T0 + 5200, channel: QUEUED_THIRDS });

		// The replaced graphic never reached program, so it leaves without an exit phase.
		expect(stateOf(state, 'bravo', T0 + 5200, QUEUED_THIRDS)).toBe('off');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5300, QUEUED_THIRDS))).toEqual([]);

		// The outgoing graphic keeps the schedule it already had, and the latest selection
		// inherits the wait rather than being queued behind the one it replaced.
		expect(stateOf(state, 'alpha', T0 + 5400, QUEUED_THIRDS)).toBe('exiting');
		expect(stateOf(state, 'charlie', T0 + 5400, QUEUED_THIRDS)).toBe('waiting');
		expect(stateOf(state, 'charlie', T0 + 5500, QUEUED_THIRDS)).toBe('entering');
		expect(onAir(state, stack, T0 + 20_000, QUEUED_THIRDS)).toEqual(['charlie']);
	});

	it('reverses an entrance still in flight rather than waiting for it', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { at: T0, channel: QUEUED_THIRDS });
		// 400ms into alpha's entrance: the graphic being replaced is entering, not settled.
		state = take(state, 'bravo', { at: T0 + 400, channel: QUEUED_THIRDS });

		// alpha unwinds its entrance in the 400ms it took to get there, and bravo waits for
		// that reversal's completion rather than for a full exit.
		expect(broadcastGraphicPhaseProjections(state, 'alpha', at(T0 + 600, QUEUED_THIRDS)))
			.toEqual([{ phase: 'enter', elapsed: 200 }]);
		expect(stateOf(state, 'bravo', T0 + 700, QUEUED_THIRDS)).toBe('waiting');
		expect(stateOf(state, 'bravo', T0 + 800, QUEUED_THIRDS)).toBe('entering');
	});

	it('waits for a graphic an operator had already Out\'d before the Take arrived', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = out(state, 'alpha', { at: T0 + 5000, channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5200, channel: QUEUED_THIRDS });

		expect(stateOf(state, 'bravo', T0 + 5400, QUEUED_THIRDS)).toBe('waiting');
		expect(stateOf(state, 'bravo', T0 + 5500, QUEUED_THIRDS)).toBe('entering');
	});

	it('does not wait when the channel is already clear', () => {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'bravo', { channel: QUEUED_THIRDS });

		expect(stateOf(state, 'bravo', T0, QUEUED_THIRDS)).toBe('entering');
		expect(stateOf(state, 'bravo', T0 + 1000, QUEUED_THIRDS)).toBe('on-air');
	});

	it('brings the waiting graphic forward when Cut Out ends the exit it was waiting for', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });
		// The outgoing graphic's exit was scheduled to complete at T0 + 5500; cutting it
		// makes its authoritative completion now, and the incoming enter begins there.
		state = out(state, 'alpha', { at: T0 + 5200, cut: true, channel: QUEUED_THIRDS });

		expect(stateOf(state, 'alpha', T0 + 5200, QUEUED_THIRDS)).toBe('off');
		expect(stateOf(state, 'bravo', T0 + 5200, QUEUED_THIRDS)).toBe('entering');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5200, QUEUED_THIRDS)))
			.toEqual([{ phase: 'enter', elapsed: 0 }]);
		expect(stateOf(state, 'bravo', T0 + 6200, QUEUED_THIRDS)).toBe('on-air');
	});

	it('leaves a waiting graphic where it is when a plain Out restates an exit already running', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		const handed = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		state = out(handed, 'alpha', { at: T0 + 5200, channel: QUEUED_THIRDS });

		expect(state).toEqual(handed);
	});
});

describe('editing a Graphic Channel Handoff Policy under a running handoff', () => {
	const stack = [graphic('alpha', 'thirds'), graphic('bravo', 'thirds')];

	it('leaves an incoming graphic that has already begun entering on program', () => {
		// The handoff started under Overlap, so bravo's entrance began at once and is
		// 200ms in, visible on program beside alpha's exit.
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });

		// The author switches the channel to Out then in mid-handoff. Waiting means a
		// graphic that has not started, so a graphic already rendering cannot become one:
		// pulling it off program would be the one case where an authoring edit removes a
		// Broadcast Graphic that is already on air.
		expect(stateOf(state, 'bravo', T0 + 5200, QUEUED_THIRDS)).toBe('entering');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5200, QUEUED_THIRDS)))
			.toEqual([{ phase: 'enter', elapsed: 200 }]);
		expect(onAir(state, stack, T0 + 5200, QUEUED_THIRDS)).toEqual(['alpha', 'bravo']);
	});

	it('still holds a graphic whose enter the handoff genuinely deferred', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		// The same reading with the policy left alone: bravo's own enter has not begun,
		// so the channel is still holding it.
		expect(stateOf(state, 'bravo', T0 + 5200, QUEUED_THIRDS)).toBe('waiting');
		expect(onAir(state, stack, T0 + 5200, QUEUED_THIRDS)).toEqual(['alpha']);
	});

	it('treats the instant an enter began as begun, not as one instant short of it', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });

		// Read at exactly the instant bravo's entrance started, with the policy flipped.
		// The outgoing exit is at its own first frame, so the channel *is* still occupied
		// — which is what makes this the reading that separates "has begun" from "has
		// progressed". A graphic is on program from the first frame of its entrance.
		expect(stateOf(state, 'bravo', T0 + 5000, QUEUED_THIRDS)).toBe('entering');
		expect(onAir(state, stack, T0 + 5000, QUEUED_THIRDS)).toEqual(['alpha', 'bravo']);
	});
});

describe('cancelling and cutting a Graphic Channel handoff', () => {
	const stack = [graphic('alpha', 'thirds'), graphic('bravo', 'thirds'), graphic('charlie', 'thirds')];

	it('cancels a waiting Take on Out, without running an exit the graphic never earned', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });
		state = out(state, 'bravo', { at: T0 + 5200, channel: QUEUED_THIRDS });

		expect(stateOf(state, 'bravo', T0 + 5200, QUEUED_THIRDS)).toBe('off');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5300, QUEUED_THIRDS))).toEqual([]);
		// The cancelled graphic stays off past the instant it would otherwise have entered.
		expect(stateOf(state, 'bravo', T0 + 5600, QUEUED_THIRDS)).toBe('off');
		// The outgoing graphic still finishes its own exit; cancelling did not touch it.
		expect(stateOf(state, 'alpha', T0 + 5300, QUEUED_THIRDS)).toBe('exiting');
		expect(onAir(state, stack, T0 + 20_000, QUEUED_THIRDS)).toEqual([]);
	});

	it('performs the handoff immediately on Cut Take, bypassing the Handoff Policy', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, cut: true, channel: QUEUED_THIRDS });

		expect(stateOf(state, 'alpha', T0 + 5000, QUEUED_THIRDS)).toBe('off');
		expect(stateOf(state, 'bravo', T0 + 5000, QUEUED_THIRDS)).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(state, 'bravo', at(T0 + 5000, QUEUED_THIRDS))).toEqual([]);
		expect(onAir(state, stack, T0 + 5000, QUEUED_THIRDS)).toEqual(['bravo']);
	});

	it('switches immediately on Cut Take under Overlap too, without overlapping', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, cut: true, channel: LOWER_THIRDS });

		expect(onAir(state, stack, T0 + 5000, LOWER_THIRDS)).toEqual(['bravo']);
	});

	it('cuts off a member the channel is still holding waiting', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });
		state = take(state, 'charlie', { at: T0 + 5200, cut: true, channel: QUEUED_THIRDS });

		expect(stateOf(state, 'alpha', T0 + 5200, QUEUED_THIRDS)).toBe('off');
		expect(stateOf(state, 'bravo', T0 + 5200, QUEUED_THIRDS)).toBe('off');
		expect(onAir(state, stack, T0 + 5200, QUEUED_THIRDS)).toEqual(['charlie']);
	});

	it('settles a Cut Take that only restates the current selection, and clears the channel with it', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: LOWER_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: LOWER_THIRDS });
		// 200ms in, the operator cuts the graphic that is already the channel's selection.
		state = take(state, 'bravo', { at: T0 + 5200, cut: true, channel: LOWER_THIRDS });

		expect(stateOf(state, 'bravo', T0 + 5200, LOWER_THIRDS)).toBe('on-air');
		expect(stateOf(state, 'alpha', T0 + 5200, LOWER_THIRDS)).toBe('off');
		expect(onAir(state, stack, T0 + 5200, LOWER_THIRDS)).toEqual(['bravo']);
	});
});

describe('what a Graphic Channel does not persist', () => {
	it('stores no channel state of its own: a handoff writes only playout intents', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		expect(Object.keys(state).sort()).toEqual(['inputs', 'playout', 'sources']);
		// Waiting is derived, so nothing in the record names it — the incoming graphic
		// stores exactly the three fields every uninterrupted intent stores.
		expect(Object.keys(state.playout.bravo!).sort()).toEqual(['cut', 'effectiveStartedAt', 'onAir']);
	});

	it('recovers a waiting Broadcast Graphic settled on air, without replaying its entrance', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		const recovered = recoveredBroadcastGraphicsLiveState(JSON.parse(JSON.stringify(state)));
		const hoursLater = T0 + 4 * 60 * 60 * 1000;

		expect(stateOf(recovered, 'bravo', hoursLater, QUEUED_THIRDS)).toBe('on-air');
		expect(broadcastGraphicPhaseProjections(recovered, 'bravo', at(hoursLater, QUEUED_THIRDS))).toEqual([]);
		expect(stateOf(recovered, 'alpha', hoursLater, QUEUED_THIRDS)).toBe('off');
	});

	it('reports the settled states without timing, because waiting is a fact about an instant', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		expect(broadcastGraphicPlayoutState(state, 'bravo')).toBe('on-air');
	});

	it('cannot report waiting to a reader that cannot see the channel, and shows the graphic instead', () => {
		let state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		state = take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });

		// The deferred start alone is never read as waiting: a reader with no channel in
		// hand reaches the target immediately rather than holding a graphic off program.
		expect(broadcastGraphicPlayoutState(state, 'bravo', at(T0 + 5200))).toBe('entering');
	});
});

describe('the Graphic Channel context read from authored Screen configuration', () => {
	const channels = [
		{ id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' as const },
		{ id: 'slates', name: 'Slates' },
	];

	it('defaults a Graphic Channel that states no policy to Overlap', () => {
		expect(graphicChannelHandoffPolicy(channels[1])).toBe('overlap');
		expect(graphicChannelHandoffPolicy(undefined)).toBe('overlap');
		expect(graphicChannelHandoffPolicy(channels[0])).toBe('out-then-in');
	});

	it('gives every member of one channel the same context, and nothing to a graphic in none', () => {
		const alpha = graphic('alpha', 'thirds');
		alpha.socialProfileProjections = [{
			key: 'profile',
			label: 'Social profile',
			sourceKey: 'talent',
			presentationGroupId: 'presentation',
			dwellMs: 8_000,
			transition: 'crossfade',
			transitionDurationMs: 250,
		}];
		const contexts = broadcastGraphicChannelContexts({
			graphics: [alpha, graphic('bug'), graphic('bravo', 'thirds')],
			channels,
		});

		expect(contexts.alpha).toBe(contexts.bravo);
		expect(contexts.alpha?.handoff).toBe('out-then-in');
		expect(contexts.alpha?.members.map(member => member.graphicId)).toEqual(['alpha', 'bravo']);
		expect(contexts.alpha?.members[0]?.socialProfileProjections).toEqual(alpha.socialProfileProjections);
		expect(contexts.bug).toBeUndefined();
	});

	it('treats membership of a Graphic Channel the Screen does not declare as no membership', () => {
		const stack = { graphics: [graphic('alpha', 'deleted-channel')], channels };

		expect(broadcastGraphicChannelContexts(stack).alpha).toBeUndefined();
		expect(graphicChannelGroups(stack)).toEqual([
			{ channel: null, graphics: [graphic('alpha', 'deleted-channel')] },
		]);
	});

	it('organises the rundown by channel, in authored order, with unchanneled graphics last', () => {
		const groups = graphicChannelGroups({
			graphics: [graphic('slate', 'slates'), graphic('bug'), graphic('alpha', 'thirds'), graphic('bravo', 'thirds')],
			channels,
		});

		expect(groups.map(group => [group.channel?.id ?? null, group.graphics.map(g => g.id)])).toEqual([
			['thirds', ['alpha', 'bravo']],
			['slates', ['slate']],
			[null, ['bug']],
		]);
	});
});

describe('what an operator may do to a waiting Broadcast Graphic', () => {
	function waitingChannel(): BroadcastGraphicsLiveState {
		const state = take(createInitialBroadcastGraphicsLiveState(), 'alpha', { channel: QUEUED_THIRDS });
		return take(state, 'bravo', { at: T0 + 5000, channel: QUEUED_THIRDS });
	}

	it('refuses Update Graphic, which is available only while a graphic is entering, on air, or updating', () => {
		const state = waitingChannel();

		expect(() => applyBroadcastGraphicsCommand(
			state,
			{ type: 'Update Graphic', payload: { graphicId: 'bravo', basedOnAcceptedRevision: 1 } },
			{ inputs: [], durations: TIMING, acceptedAt: T0 + 5200, channel: QUEUED_THIRDS },
		)).toThrow(/only while a Broadcast Graphic is entering, on air, or updating/);
	});

	it('accepts Update Graphic again once its Graphic Channel has cleared and it has entered', () => {
		const state = waitingChannel();

		expect(() => applyBroadcastGraphicsCommand(
			state,
			{ type: 'Update Graphic', payload: { graphicId: 'bravo', basedOnAcceptedRevision: 1 } },
			{ inputs: [], durations: TIMING, acceptedAt: T0 + 5600, channel: QUEUED_THIRDS },
		)).not.toThrow();
	});

	/**
	 * A live On-air Update Policy input, and the reduction context that carries it.
	 *
	 * The same declaration a lower third's name would carry: bound to nothing, so its
	 * working value is what an edit changes and what an acceptance would take.
	 */
	const LIVE_NAME = {
		type: 'text',
		key: 'name',
		label: 'Name',
		required: false,
		updatePolicy: 'live',
		default: '',
		maxLength: 40,
	} as const;

	function liveContext(at: number) {
		return { inputs: [LIVE_NAME], durations: TIMING, acceptedAt: at, channel: QUEUED_THIRDS };
	}

	it('leaves a live-policy Graphic Input edit staged, exactly as Update Graphic is refused', () => {
		const state = waitingChannel();

		const edited = applyBroadcastGraphicsCommand(
			state,
			{ type: 'Set Input', payload: { graphicId: 'bravo', inputKey: 'name', value: 'CHANGED' } },
			liveContext(T0 + 5200),
		);

		// A waiting Broadcast Graphic is absent from every output, so nothing an operator
		// types can reach air through it. It enters with the values its Take accepted —
		// which is the very rule Update Graphic is refused on — and the edit changes the
		// working value it will next be taken with.
		expect(broadcastGraphicInputsState(edited, 'bravo').accepted).toEqual({});
		expect(broadcastGraphicInputsState(edited, 'bravo').working).toEqual({ name: 'CHANGED' });
	});

	it('applies that same edit the moment the graphic has entered', () => {
		const state = waitingChannel();

		const edited = applyBroadcastGraphicsCommand(
			state,
			{ type: 'Set Input', payload: { graphicId: 'bravo', inputKey: 'name', value: 'CHANGED' } },
			liveContext(T0 + 5600),
		);

		expect(broadcastGraphicInputsState(edited, 'bravo').accepted).toEqual({ name: 'CHANGED' });
	});
});
