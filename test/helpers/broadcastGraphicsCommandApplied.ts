import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsReductionContext,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
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
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import {
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_TEXT_LENGTH,
} from '~~/shared/types/graphics';
import { realtimeMessageBytes } from '~~/shared/types/messages';

// Live states for measuring `broadcastGraphicsLiveSession:commandApplied`, built by
// reducing real commands so every value is one the command surface accepts (ADR-0004).

const GRAPHIC_ID_LENGTH = 100;

export function row(currentState: unknown, sequence = 4): DbBroadcastGraphicsLiveSession {
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

export function payloadFor(
	before: BroadcastGraphicsLiveState | undefined,
	after: unknown,
	commandType: Parameters<typeof mapBroadcastGraphicsCommandResult>[1] = 'Take',
) {
	return broadcastGraphicsCommandAppliedPayload(mapBroadcastGraphicsCommandResult(row(after), commandType), before);
}

export function messageBytes(payload: ReturnType<typeof broadcastGraphicsCommandAppliedPayload>): number {
	return realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', payload);
}

/** What the old whole-live-state notification would have cost for `state`. */
export function wholeStateBytes(state: BroadcastGraphicsLiveState): number {
	return realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', {
		screenId: 7,
		sessionId: 12,
		sequence: 4,
		commandType: 'Take',
		currentState: state,
	} as never);
}

export function inputKeys(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${index}`.padStart(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'));
}

export function declarations(keys: string[]): GraphicInputDeclaration[] {
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

export function reduce(
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
 * A live state at every Screen-wide cap, with the Graphic Inputs and Graphic Source
 * Selections shared between the given numbers of Broadcast Graphics: each Graphic
 * Input bound, accepted, updated twice with one update in flight, then given a
 * maximal override and working value.
 */
export function liveStateAtCaps(inputCarriers: number, sourceCarriers: number): BroadcastGraphicsLiveState {
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

/** The Broadcast Graphic carrying the most Graphic Inputs. */
export function richestGraphicId(state: BroadcastGraphicsLiveState): string {
	return Object.entries(state.inputs)
		.sort(([, a], [, b]) => Object.keys(b.working).length - Object.keys(a.working).length)[0]![0];
}

/**
 * One Broadcast Graphic with `count` Graphic Inputs, every value map full, plus
 * `padding` inputs holding only a working value of the given lengths.
 */
export function fullyFilledState(count: number, padding: readonly number[] = []) {
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

/** A maximal edit to the first Graphic Input of a fully-filled Broadcast Graphic, as published. */
export function editFirstInput(count: number) {
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

/** Six Broadcast Graphics of eight Graphic Inputs each, sixty-character values, all on air. */
export function realisticShow() {
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

	return { state, edit, off };
}
