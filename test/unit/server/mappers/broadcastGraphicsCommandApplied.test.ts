import type { BroadcastGraphicsCommandInput, BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsCommandAppliedPayload,
	mapBroadcastGraphicsCommandResult,
} from '~~/server/mappers/broadcastGraphicsLiveSession';
import { MAX_GRAPHIC_INPUT_VALUE_LENGTH } from '~~/server/schemas/api/broadcastGraphicsLiveSession';
import {
	MAX_BROADCAST_GRAPHICS_PER_SCREEN,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
} from '~~/server/schemas/api/screen';
import {
	applyBroadcastGraphicsCommand,
	changedBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN } from '~~/shared/types/graphics';
import { MAX_REALTIME_MESSAGE_BYTES } from '~~/shared/types/messages';
import {
	declarations,
	editFirstInput,
	fullyFilledState,
	liveStateAtCaps,
	messageBytes,
	payloadFor,
	realisticShow,
	richestGraphicId,
	row,
} from '~~/test/helpers/broadcastGraphicsCommandApplied';

// `broadcastGraphicsLiveSession:commandApplied` carries the difference a command made,
// never the whole live state, and stays within the realtime per-message limit at any
// size the authoring caps admit by dropping the difference when it cannot fit (#168).
// The byte figures ADR-0004 records live in broadcastGraphicsCommandAppliedMeasurements.test.ts.

/**
 * A Graphic Input edit whose change is the largest that still fits without an origin
 * connection id, found by searching the padding so it stays at the boundary.
 */
function atTheCarryingBoundary() {
	const build = (padding: number) => {
		const { graphicId, keys, context, state } = fullyFilledState(11, [MAX_GRAPHIC_INPUT_VALUE_LENGTH, MAX_GRAPHIC_INPUT_VALUE_LENGTH, padding]);
		const command: BroadcastGraphicsCommandInput = {
			type: 'Set Input',
			payload: {
				graphicId,
				inputKey: keys[0]!,
				value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH),
			},
		};
		return {
			state,
			command,
			context: context(),
		};
	};
	const fits = (padding: number): boolean => {
		const { state, command, context } = build(padding);
		return payloadFor(state, applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt: 1_400 }), 'Set Input').change !== undefined;
	};

	let low = 0;
	let high = MAX_GRAPHIC_INPUT_VALUE_LENGTH;
	if (fits(high))
		throw new Error('the padding range no longer spans the carrying boundary');

	while (low < high - 1) {
		const middle = Math.floor((low + high) / 2);
		if (fits(middle))
			low = middle;
		else
			high = middle;
	}

	return build(low);
}

describe('the commandApplied notification at the largest live session the caps admit', () => {
	// Spread fills the most records; concentrated fills one graphic's record the most.
	const spreadState = liveStateAtCaps(50, 40);
	const concentrated = liveStateAtCaps(3, 5);

	it('is measured against a live state that fills every cap the Screen has', () => {
		const filled = Object.values(spreadState.inputs);
		const inputCount = filled.reduce((total, inputs) => total + Object.keys(inputs.working).length, 0);
		const sourceCount = Object.values(spreadState.sources ?? {})
			.reduce((total, selections) => total + Object.keys(selections).length, 0);

		expect(Object.keys(spreadState.playout)).toHaveLength(MAX_BROADCAST_GRAPHICS_PER_SCREEN);
		expect(inputCount).toBe(MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN);
		expect(sourceCount).toBe(MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN);
		for (const inputs of filled) {
			for (const map of [
				'working',
				'overrides',
				'accepted',
				'updateFrom',
				'pendingUpdateFrom',
			] as const)
				expect(Object.keys(inputs[map] ?? {})).toHaveLength(Object.keys(inputs.working).length);
		}
	});

	it('carries an Out as a playout-only change however much text the Broadcast Graphic holds', () => {
		const after = applyBroadcastGraphicsCommand(spreadState, {
			type: 'Out',
			payload: {
				graphicId: richestGraphicId(spreadState),
			},
		}, {
			inputs: [],
			acceptedAt: 2_000,
			durations: { enter: 0, update: 10_000, exit: 500 },
		});

		const payload = payloadFor(spreadState, after, 'Out');

		expect(payload.change?.playout).toBeDefined();
		expect(payload.change?.inputs).toBeUndefined();
	});

	it('fits within the realtime per-message limit for every command, in either arrangement', () => {
		for (const state of [spreadState, concentrated]) {
			const graphicId = richestGraphicId(state);
			const keys = Object.keys(state.inputs[graphicId]!.working);
			const context = {
				inputs: declarations(keys),
				sources: [
					{ key: keys[0]!, label: keys[0]!, kind: 'player' as const },
				],
				bindings: keys.map(key => ({ inputKey: key, sourceKey: keys[0]!, fieldId: 'name' })),
				durations: { enter: 0, update: 10_000, exit: 500 },
			};
			const value = 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH);
			const commands: BroadcastGraphicsCommandInput[] = [
				{
					type: 'Out',
					payload: { graphicId },
				},
				{
					type: 'Set Input',
					payload: { graphicId, inputKey: keys[0]!, value },
				},
				{
					type: 'Set Override',
					payload: { graphicId, inputKey: keys[0]!, value },
				},
				{
					type: 'Select Source',
					payload: { graphicId, sourceKey: keys[0]!, selectionId: 1 },
				},
			];

			for (const command of commands) {
				const after = applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt: 2_000 });

				expect(messageBytes(payloadFor(state, after))).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
			}
		}
	});

	it('drops the change rather than the limit when one Broadcast Graphic’s Graphic Input state is too large', () => {
		const graphicId = richestGraphicId(concentrated);
		const keys = Object.keys(concentrated.inputs[graphicId]!.working);
		const after = applyBroadcastGraphicsCommand(concentrated, {
			type: 'Set Input',
			payload: {
				graphicId,
				inputKey: keys[0]!,
				value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH),
			},
		}, {
			inputs: declarations(keys),
			acceptedAt: 2_000,
		});

		const payload = payloadFor(concentrated, after);

		expect(payload.change).toBeUndefined();
		expect(messageBytes(payload)).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
	});

	it('measures the complete message it will publish, envelope and origin included', () => {
		// At the boundary the origin connection id is the whole difference, so a guard that
		// measured only the change, or forgot the origin, would be wrong here alone.
		const { state, command, context } = atTheCarryingBoundary();
		const after = applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt: 1_400 });
		const result = mapBroadcastGraphicsCommandResult(row(after), 'Set Input');

		const bare = broadcastGraphicsCommandAppliedPayload(result, state);
		const echoed = broadcastGraphicsCommandAppliedPayload(result, state, 'c'.repeat(48));

		expect(bare.change).toBeDefined();
		expect(messageBytes(bare)).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
		expect(echoed.change).toBeUndefined();
	});
});

describe('broadcastGraphicsCommandAppliedPayload', () => {
	const before: BroadcastGraphicsLiveState = {
		playout: {
			bug: { onAir: true, effectiveStartedAt: 5, cut: false },
		},
		inputs: {
			bug: {
				working: { name: 'Bug' },
				accepted: { name: 'Bug' },
				acceptedRevision: 1,
			},
		},
		sources: {},
	};

	it('carries a change a peer can apply to land on exactly the committed state', () => {
		const after = applyBroadcastGraphicsCommand(before, {
			type: 'Take',
			payload: { graphicId: 'slate' },
		}, {
			inputs: [],
			acceptedAt: 1_000,
		});

		const payload = payloadFor(before, after);

		expect(payload.change).toBeDefined();
		expect(changedBroadcastGraphicsLiveState(before, payload.change!)).toEqual(after);
	});

	it('names the epoch and sequence a peer decides from, whether or not it carries a change', () => {
		const payload = payloadFor(undefined, before, 'Out');

		expect(payload).toMatchObject({
			screenId: 7,
			sessionId: 12,
			sequence: 4,
			commandType: 'Out',
		});
		expect(payload.change).toBeUndefined();
	});

	it('carries no change for a replay, which has no state it was reduced onto', () => {
		expect(payloadFor(undefined, before).change).toBeUndefined();
	});

	it('carries no change when live state holds something a change cannot describe', () => {
		const unknown = { ...before, epoch: 'later' } as BroadcastGraphicsLiveState;

		expect(payloadFor(before, unknown).change).toBeUndefined();
	});

	it('carries an empty change, not none, when an accepted command left live state as it was', () => {
		expect(payloadFor(before, before).change).toEqual({});
	});
});

describe('where the change stops being carried', () => {
	it('carries a Graphic Input edit while one Broadcast Graphic\'s record fits, and falls back to a reload once it does not', () => {
		const fits = editFirstInput(4);
		const tooLarge = editFirstInput(MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC);

		expect(fits.change).toBeDefined();
		expect(messageBytes(fits)).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
		expect(tooLarge.change).toBeUndefined();
		expect(messageBytes(tooLarge)).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
	});

	it('carries every edit and Out on a realistic show', () => {
		const { edit, off } = realisticShow();

		expect(edit.change).toBeDefined();
		expect(off.change).toBeDefined();
	});
});
