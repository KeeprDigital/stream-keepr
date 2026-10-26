import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsReductionContext,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
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
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import {
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_TEXT_LENGTH,
} from '~~/shared/types/graphics';
import { MAX_REALTIME_MESSAGE_BYTES, realtimeMessageBytes } from '~~/shared/types/messages';

// `broadcastGraphicsLiveSession:commandApplied` carries the difference a command made,
// never the whole live state, and stays within the realtime per-message limit at any
// size the authoring caps admit by dropping the difference when it cannot fit (#168).

const GRAPHIC_ID_LENGTH = 100;

function row(currentState: unknown, sequence = 4): DbBroadcastGraphicsLiveSession {
	return {
		id: 12,
		eventId: 3,
		screenId: 7,
		status: 'active',
		currentState,
		sequence,
		endedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	} as DbBroadcastGraphicsLiveSession;
}

function payloadFor(
	before: BroadcastGraphicsLiveState | undefined,
	after: unknown,
	commandType: Parameters<typeof mapBroadcastGraphicsCommandResult>[1] = 'Take',
) {
	return broadcastGraphicsCommandAppliedPayload(mapBroadcastGraphicsCommandResult(row(after), commandType), before);
}

function messageBytes(payload: ReturnType<typeof broadcastGraphicsCommandAppliedPayload>): number {
	return realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', payload);
}

function inputKeys(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${index}`.padStart(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'));
}

function declarations(keys: string[]): GraphicInputDeclaration[] {
	return keys.map(key => ({
		key,
		label: key,
		type: 'text',
		required: false,
		maxLength: MAX_GRAPHIC_TEXT_LENGTH,
		updatePolicy: 'staged',
		default: '',
	}));
}

function reduce(
	state: BroadcastGraphicsLiveState,
	command: BroadcastGraphicsCommandInput,
	context: Omit<BroadcastGraphicsReductionContext, 'acceptedAt'>,
	acceptedAt: number,
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt });
}

/** `total` spread as evenly as possible over the first `carriers` Broadcast Graphics. */
function spread(total: number, carriers: number, perGraphic: number): number[] {
	if (carriers * perGraphic < total)
		throw new Error(`${carriers} Broadcast Graphics cannot carry ${total} at ${perGraphic} each`);

	return Array.from(
		{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
		(_, index) => index >= carriers
			? 0
			: Math.floor(total / carriers) + (index < total % carriers
				? 1
				: 0),
	);
}

/**
 * A live state at every Screen-wide cap, reached through the reducer: each Graphic
 * Input bound, accepted, updated twice with one update in flight, then given a
 * maximal override and working value.
 */
function liveStateAtCaps(inputCarriers: number, sourceCarriers: number): BroadcastGraphicsLiveState {
	const ids = Array.from({ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN }, (_, index) => `${index}`.padStart(GRAPHIC_ID_LENGTH, 'g'));
	const inputCounts = spread(MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN, inputCarriers, MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC);
	const sourceCounts = spread(MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN, sourceCarriers, MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC);
	const authored = 'a'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	const wire = 'w'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH);
	let state = createInitialBroadcastGraphicsLiveState();

	ids.forEach((graphicId, index) => {
		const keys = inputKeys(inputCounts[index]!);
		const sourceKeys = inputKeys(Math.max(sourceCounts[index]!, 1));
		let resolved = `1${authored.slice(1)}`;
		const context = {
			inputs: declarations(keys),
			sources: sourceKeys.map(key => ({ key, label: key, kind: 'player' as const })),
			bindings: keys.map(key => ({ inputKey: key, sourceKey: sourceKeys[0]!, fieldId: 'name' })),
			resolveBindings: () => Object.fromEntries(keys.map(key => [key, resolved])),
			durations: { enter: 0, update: 10_000, exit: 500 },
		} satisfies Omit<BroadcastGraphicsReductionContext, 'acceptedAt'>;

		for (const sourceKey of sourceKeys.slice(0, sourceCounts[index]!)) {
			state = reduce(state, {
				type: 'Select Source',
				payload: { graphicId, sourceKey, selectionId: 999_999 },
			}, context, 900);
		}

		state = reduce(state, {
			type: 'Take',
			payload: { graphicId },
		}, context, 1_000);
		resolved = `2${authored.slice(1)}`;
		state = reduce(state, {
			type: 'Update Graphic',
			payload: { graphicId, basedOnAcceptedRevision: 1 },
		}, context, 1_100);
		resolved = `3${authored.slice(1)}`;
		state = reduce(state, {
			type: 'Update Graphic',
			payload: { graphicId, basedOnAcceptedRevision: 2 },
		}, context, 1_200);

		for (const key of keys) {
			state = reduce(state, {
				type: 'Set Override',
				payload: { graphicId, inputKey: key, value: wire },
			}, context, 1_300);
			state = reduce(state, {
				type: 'Set Input',
				payload: { graphicId, inputKey: key, value: wire },
			}, context, 1_300);
		}
	});

	// The three optional schedule fields no single command writes together.
	return {
		...state,
		playout: Object.fromEntries(Object.entries(state.playout).map(([graphicId, record]) => [
			graphicId,
			{
				...record,
				cut: true,
				reversalCompletesAt: 1_999_999_999_999,
				updateStartedAt: 1_999_999_999_999,
				cyclingStartedAt: 1_999_999_999_999,
			},
		])),
	};
}

function richestGraphicId(state: BroadcastGraphicsLiveState): string {
	return Object.entries(state.inputs)
		.sort(([, a], [, b]) => Object.keys(b.working).length - Object.keys(a.working).length)[0]![0];
}

/**
 * One Broadcast Graphic with `count` Graphic Inputs, every value map full, plus
 * `padding` inputs holding only a working value of the given lengths.
 */
function fullyFilledState(count: number, padding: readonly number[] = []) {
	const graphicId = 'g'.repeat(GRAPHIC_ID_LENGTH);
	const keys = inputKeys(count);
	const paddingKeys = inputKeys(count + padding.length).slice(count);
	let resolved = '1'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	const context = (): Omit<BroadcastGraphicsReductionContext, 'acceptedAt'> => ({
		inputs: declarations([
			...keys,
			...paddingKeys,
		]),
		sources: [
			{ key: keys[0]!, label: keys[0]!, kind: 'player' as const },
		],
		bindings: keys.map(key => ({ inputKey: key, sourceKey: keys[0]!, fieldId: 'name' })),
		resolveBindings: () => Object.fromEntries(keys.map(key => [key, resolved])),
		durations: { enter: 0, update: 10_000, exit: 500 },
	});
	const wire = 'w'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH);

	let state = createInitialBroadcastGraphicsLiveState();
	state = reduce(state, {
		type: 'Take',
		payload: { graphicId },
	}, context(), 1_000);
	resolved = '2'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	state = reduce(state, {
		type: 'Update Graphic',
		payload: { graphicId, basedOnAcceptedRevision: 1 },
	}, context(), 1_100);
	resolved = '3'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	state = reduce(state, {
		type: 'Update Graphic',
		payload: { graphicId, basedOnAcceptedRevision: 2 },
	}, context(), 1_200);
	for (const key of keys) {
		state = reduce(state, {
			type: 'Set Override',
			payload: { graphicId, inputKey: key, value: wire },
		}, context(), 1_300);
		state = reduce(state, {
			type: 'Set Input',
			payload: { graphicId, inputKey: key, value: wire },
		}, context(), 1_300);
	}
	paddingKeys.forEach((key, index) => {
		state = reduce(state, {
			type: 'Set Input',
			payload: {
				graphicId,
				inputKey: key,
				value: 'p'.repeat(padding[index]!),
			},
		}, context(), 1_350);
	});

	return { graphicId, keys, context, state };
}

function editFirstInput(count: number) {
	const { graphicId, keys, context, state } = fullyFilledState(count);
	const after = reduce(state, {
		type: 'Set Input',
		payload: {
			graphicId,
			inputKey: keys[0]!,
			value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH),
		},
	}, context(), 1_400);

	return payloadFor(state, after, 'Set Input');
}

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
		const keys = Array.from({ length: 8 }, (_, index) => `input${index}`);
		const context = {
			inputs: keys.map(key => ({
				key,
				label: key,
				type: 'text' as const,
				required: false,
				maxLength: 200,
				updatePolicy: 'staged' as const,
				default: '',
			})),
			durations: { enter: 500, update: 300, exit: 500 },
		};
		let state = createInitialBroadcastGraphicsLiveState();
		for (let index = 0; index < 6; index++) {
			const graphicId = `graphic-${index}`;
			for (const key of keys) {
				state = reduce(state, {
					type: 'Set Input',
					payload: {
						graphicId,
						inputKey: key,
						value: 'v'.repeat(60),
					},
				}, context, 1_000);
			}
			state = reduce(state, {
				type: 'Take',
				payload: { graphicId },
			}, context, 1_000);
		}

		const edit = payloadFor(state, reduce(state, {
			type: 'Set Input',
			payload: {
				graphicId: 'graphic-0',
				inputKey: keys[0]!,
				value: 'q'.repeat(60),
			},
		}, context, 2_000), 'Set Input');
		const off = payloadFor(state, reduce(state, {
			type: 'Out',
			payload: { graphicId: 'graphic-0' },
		}, context, 2_000), 'Out');

		expect(edit.change).toBeDefined();
		expect(off.change).toBeDefined();
	});
});
