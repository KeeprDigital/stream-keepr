import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	broadcastGraphicsLiveStateChange,
	changedBroadcastGraphicsLiveState,
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * What a `commandApplied` notification carries, and what a peer does with it.
 *
 * The rule this exists to keep is the one the whole realtime path already
 * follows: a peer that applies a notification in place must land on exactly the
 * state the authoritative snapshot would have given it. So every assertion here
 * is the same shape — reduce a real command, describe the difference, apply the
 * description to the state a peer was holding, and require the result to equal
 * what the server committed.
 */

const NAME: GraphicInputDeclaration = {
	key: 'name',
	label: 'Name',
	type: 'text',
	required: false,
	maxLength: 1000,
	onAirUpdatePolicy: 'staged',
};

function context(acceptedAt = 1_000) {
	return { inputs: [NAME], acceptedAt };
}

/** One command reduced, then described and re-applied by a peer holding `before`. */
function converges(
	before: ReturnType<typeof createInitialBroadcastGraphicsLiveState>,
	command: Parameters<typeof applyBroadcastGraphicsCommand>[1],
	acceptedAt = 1_000,
) {
	const after = applyBroadcastGraphicsCommand(before, command, context(acceptedAt));
	const change = broadcastGraphicsLiveStateChange(before, after);
	expect(change).not.toBeNull();
	return { after, change: change!, applied: changedBroadcastGraphicsLiveState(before, change!) };
}

describe('broadcastGraphicsLiveStateChange', () => {
	it('carries only the Broadcast Graphic a Take addressed, and converges on the committed state', () => {
		const before = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { bug: { onAir: true, effectiveStartedAt: 5, cut: false } },
			inputs: { bug: { working: { name: 'Bug' }, accepted: { name: 'Bug' }, acceptedRevision: 1 } },
		};

		const { after, change, applied } = converges(before, {
			type: 'Take',
			payload: { graphicId: 'slate' },
		});

		// A Take composes its accepted values afresh, so it writes a Graphic Input entry
		// as well as a playout record — for the graphic it addressed and no other.
		expect(Object.keys(change.playout ?? {})).toEqual(['slate']);
		expect(Object.keys(change.inputs ?? {})).toEqual(['slate']);
		expect(applied).toEqual(after);
	});

	it('carries one Graphic Input edit without the rest of the Screen', () => {
		const before = {
			...createInitialBroadcastGraphicsLiveState(),
			inputs: {
				slate: { working: { name: 'Ava' }, accepted: {}, acceptedRevision: 0 },
				bug: { working: { name: 'Ben' }, accepted: {}, acceptedRevision: 0 },
			},
		};

		const { after, change, applied } = converges(before, {
			type: 'Set Input',
			payload: { graphicId: 'slate', inputKey: 'name', value: 'Beatrix' },
		});

		expect(Object.keys(change.inputs ?? {})).toEqual(['slate']);
		expect(change.playout).toBeUndefined();
		expect(applied).toEqual(after);
	});

	it('describes nothing when a command left the live state exactly as it was', () => {
		const before = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { slate: { onAir: false, effectiveStartedAt: 5, cut: false } },
		};

		const change = broadcastGraphicsLiveStateChange(before, before);

		expect(change).toEqual({});
		expect(changedBroadcastGraphicsLiveState(before, change!)).toEqual(before);
	});

	it('removes a Broadcast Graphic a peer holds that the committed state no longer has', () => {
		const before = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { slate: { onAir: true, effectiveStartedAt: 5, cut: false } },
			inputs: { slate: { working: { name: 'Ava' }, accepted: {}, acceptedRevision: 0 } },
			sources: { slate: { player: 7 } },
		};
		const after = createInitialBroadcastGraphicsLiveState();

		const change = broadcastGraphicsLiveStateChange(before, after);

		expect(change).toEqual({ playout: { slate: null }, inputs: { slate: null }, sources: { slate: null } });
		expect(changedBroadcastGraphicsLiveState(before, change!)).toEqual(after);
	});

	it('carries every Broadcast Graphic an Out-then-in channel handoff moved', () => {
		const before = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: {
				lower1: { onAir: true, effectiveStartedAt: 0, cut: false },
				lower2: { onAir: true, effectiveStartedAt: 900, cut: false },
			},
		};

		const after = applyBroadcastGraphicsCommand(before, { type: 'Out', payload: { graphicId: 'lower1' } }, {
			inputs: [],
			acceptedAt: 1_000,
			durations: { enter: 500, exit: 500, update: 0 },
			channel: {
				handoff: 'out-then-in',
				members: [{ graphicId: 'lower1' }, { graphicId: 'lower2' }],
			},
		} as Parameters<typeof applyBroadcastGraphicsCommand>[2]);
		const change = broadcastGraphicsLiveStateChange(before, after);

		expect(changedBroadcastGraphicsLiveState(before, change!)).toEqual(after);
	});

	it('refuses to describe a difference it cannot express, so the peer reloads instead', () => {
		const before = createInitialBroadcastGraphicsLiveState();
		// A field this build does not know about: live state passes unknown fields
		// through untouched, so a difference may sit somewhere this description has
		// no room for. Answering null is what sends the peer to the snapshot.
		const after = { ...createInitialBroadcastGraphicsLiveState(), epoch: 'later' } as never;

		expect(broadcastGraphicsLiveStateChange(before, after)).toBeNull();
	});
});
