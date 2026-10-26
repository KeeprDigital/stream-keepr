import { describe, expect, it } from 'vitest';
import { applyBroadcastGraphicsCommand } from '~~/shared/modules/broadcast-graphics-live-session';
import { MAX_REALTIME_MESSAGE_BYTES } from '~~/shared/types/messages';
import {
	editFirstInput,
	fullyFilledState,
	liveStateAtCaps,
	messageBytes,
	payloadFor,
	realisticShow,
	reduce,
	richestGraphicId,
	wholeStateBytes,
} from '~~/test/helpers/broadcastGraphicsCommandApplied';

// The measured cost of `broadcastGraphicsLiveSession:commandApplied` that ADR-0004
// records, pinned with `toBe` so that a vocabulary or encoding change moves a figure
// visibly. The dearest whole live state spreads the Screen's Graphic Inputs over every
// Broadcast Graphic; the dearest single change concentrates them on one. The
// semantic contract lives in broadcastGraphicsCommandApplied.test.ts.

/** A Take on a Broadcast Graphic whose Graphic Input record is already loaded. */
function retaken(count: number) {
	const { graphicId, context, state } = fullyFilledState(count);
	const off = reduce(state, {
		type: 'Out',
		payload: { graphicId, cut: true },
	}, context(), 1_400);

	return payloadFor(off, reduce(off, {
		type: 'Take',
		payload: { graphicId },
	}, context(), 1_500), 'Take');
}

describe('commandApplied measured cost (ADR-0004)', () => {
	const spread = liveStateAtCaps(50, 40);

	it('spreads the Screen\'s Graphic Inputs over every Broadcast Graphic for the dearest whole state', () => {
		// One fewer carrier of either kind is already cheaper, so this is a peak.
		for (const [inputCarriers, sourceCarriers] of [
			[49, 40],
			[50, 39],
			[3, 5],
			[3, 40],
			[5, 5],
			[12, 20],
			[25, 20],
			[50, 5],
		] as const)
			expect(wholeStateBytes(liveStateAtCaps(inputCarriers, sourceCarriers))).toBeLessThan(wholeStateBytes(spread));

		expect(wholeStateBytes(liveStateAtCaps(3, 5))).toBe(361_780);
	});

	it('would have been five times the per-message limit as whole live state, where an Out costs 280 bytes', () => {
		const after = applyBroadcastGraphicsCommand(spread, {
			type: 'Out',
			payload: {
				graphicId: richestGraphicId(spread),
			},
		}, {
			inputs: [],
			acceptedAt: 2_000,
			durations: { enter: 0, update: 10_000, exit: 500 },
		});

		expect(wholeStateBytes(spread)).toBe(367_053);
		expect(wholeStateBytes(spread)).toBeGreaterThan(MAX_REALTIME_MESSAGE_BYTES * 5);
		expect(messageBytes(payloadFor(spread, after, 'Out'))).toBe(280);
	});

	it('carries a Graphic Input edit up to eleven maximal Graphic Inputs on one Broadcast Graphic, and reloads from the twelfth', () => {
		expect(editFirstInput(11).change).toBeDefined();
		expect(messageBytes(editFirstInput(11))).toBe(62_260);
		expect(editFirstInput(12).change).toBeUndefined();
		expect(messageBytes(editFirstInput(12))).toBe(106);
	});

	it('carries a Take up to fourteen maximal Graphic Inputs on one Broadcast Graphic, and reloads from the fifteenth', () => {
		expect(retaken(14).change).toBeDefined();
		expect(messageBytes(retaken(14))).toBe(64_670);
		expect(retaken(15).change).toBeUndefined();
		expect(messageBytes(retaken(15))).toBe(101);
	});

	it('costs a realistic show 1,355 bytes an edit and 189 an Out, against 7,906 as whole live state', () => {
		const { state, edit, off } = realisticShow();

		expect(wholeStateBytes(state)).toBe(7_906);
		expect(messageBytes(edit)).toBe(1_355);
		expect(messageBytes(off)).toBe(189);
	});
});
