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

/**
 * What `broadcastGraphicsLiveSession:commandApplied` puts on the wire, and how big
 * it is at the largest live session the authoring caps admit.
 *
 * The defect (#168) was that the notification carried the whole
 * `BroadcastGraphicsLiveState` on every accepted command — measured here — against a
 * realtime per-message limit measured in tens of kilobytes, and failed silently
 * because publication logs and swallows. So the assertions are in two halves: the
 * message a command publishes is within the limit at *any* legal size, and the
 * difference it carries is enough for a peer to land on exactly the state the server
 * committed without fetching anything.
 *
 * The worst case is built by reducing real commands rather than by writing down a
 * state that looks expensive. Every value in it is one the command surface accepts,
 * and every field is one an accepted command wrote.
 */

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

// ──────────────── the worst case the caps admit ────────────────

/** Maximal Broadcast Graphic ids, so the keys of every map cost what they may. */
function graphicIds(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${index}`.padStart(GRAPHIC_ID_LENGTH, 'g'));
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
		onAirUpdatePolicy: 'staged',
	}));
}

/**
 * How the Graphic Inputs a Screen may declare are spread over its Broadcast
 * Graphics: as few graphics as the per-graphic cap allows, since the total is what
 * the payload is built from and a graphic carrying none costs only its playout record.
 */
function inputCounts(): number[] {
	const counts: number[] = [];
	let remaining = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN;
	for (let index = 0; index < MAX_BROADCAST_GRAPHICS_PER_SCREEN; index++) {
		const count = Math.min(remaining, MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC);
		counts.push(count);
		remaining -= count;
	}
	return counts;
}

function reduce(
	state: BroadcastGraphicsLiveState,
	command: BroadcastGraphicsCommandInput,
	context: Omit<BroadcastGraphicsReductionContext, 'acceptedAt'>,
	acceptedAt: number,
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt });
}

/**
 * The largest live state a Broadcast Graphics Screen can reach, driven through the
 * reducer.
 *
 * Per Broadcast Graphic, in order: every declared Graphic Input bound and resolving a
 * maximal authored value, then taken on air, so `accepted` is full; the Event Data
 * underneath moved and accepted twice with an update still in flight, so `updateFrom`
 * and `pendingUpdateFrom` are both full; then a Graphic Input Override and a working
 * value at the full wire length, which the declaration's own `maxLength` makes
 * unavailable and acceptance therefore passes over — which is exactly why those two
 * may be longer than anything that reaches air.
 */
function worstCaseLiveState(): BroadcastGraphicsLiveState {
	const ids = graphicIds(MAX_BROADCAST_GRAPHICS_PER_SCREEN);
	const counts = inputCounts();
	const authored = 'a'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	const wire = 'w'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH);
	let state = createInitialBroadcastGraphicsLiveState();

	ids.forEach((graphicId, index) => {
		const keys = inputKeys(counts[index]!);
		const sourceKeys = inputKeys(MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC);
		// What the bindings currently resolve, moved between acceptances: an update
		// crosses two renderings, so a second one has to arrive while the first is still
		// running for the chain to hold both.
		let resolved = `1${authored.slice(1)}`;
		const context = {
			inputs: declarations(keys),
			sources: sourceKeys.map(key => ({ key, label: key, kind: 'player' as const })),
			bindings: keys.map(key => ({ inputKey: key, sourceKey: sourceKeys[0]!, fieldId: 'name' })),
			resolveBindings: () => Object.fromEntries(keys.map(key => [key, resolved])),
			durations: { enter: 0, update: 10_000, exit: 500 },
		} satisfies Omit<BroadcastGraphicsReductionContext, 'acceptedAt'>;

		if (index * MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC < MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN) {
			for (const sourceKey of sourceKeys)
				state = reduce(state, { type: 'Select Source', payload: { graphicId, sourceKey, selectionId: 999_999 } }, context, 900);
		}

		state = reduce(state, { type: 'Take', payload: { graphicId } }, context, 1_000);

		resolved = `2${authored.slice(1)}`;
		state = reduce(state, { type: 'Update Graphic', payload: { graphicId, basedOnAcceptedRevision: 1 } }, context, 1_100);

		resolved = `3${authored.slice(1)}`;
		state = reduce(state, { type: 'Update Graphic', payload: { graphicId, basedOnAcceptedRevision: 2 } }, context, 1_200);

		for (const key of keys) {
			state = reduce(state, { type: 'Set Override', payload: { graphicId, inputKey: key, value: wire } }, context, 1_300);
			state = reduce(state, { type: 'Set Input', payload: { graphicId, inputKey: key, value: wire } }, context, 1_300);
		}
	});

	// The playout record's three optional schedule fields, each written by an accepted
	// command in its own right — a reversal by Out during enter, an update by Update
	// Graphic, cycling's origin by Out over an on-screen recipe — but never by one
	// command, since each needs the graphic in a different state. Added here so the
	// figure is the worst a *stored* record can be rather than the worst one command
	// happens to leave.
	return {
		...state,
		playout: Object.fromEntries(Object.entries(state.playout).map(([graphicId, record]) => [graphicId, {
			...record,
			cut: true,
			reversalCompletesAt: 1_999_999_999_999,
			updateStartedAt: 1_999_999_999_999,
			cyclingStartedAt: 1_999_999_999_999,
		}])),
	};
}

describe('the commandApplied notification at the largest live session the caps admit', () => {
	const worst = worstCaseLiveState();

	it('is built from a live state that fills every Graphic Input the Screen may declare', () => {
		// Guards the measurement itself: a builder that quietly stopped filling one of
		// the five value maps would report a comfortable figure for the wrong state.
		const filled = Object.values(worst.inputs);
		const inputCount = filled.reduce((total, inputs) => total + Object.keys(inputs.working).length, 0);

		expect(Object.keys(worst.playout)).toHaveLength(MAX_BROADCAST_GRAPHICS_PER_SCREEN);
		expect(inputCount).toBe(MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN);
		for (const inputs of filled) {
			for (const map of ['working', 'overrides', 'accepted', 'updateFrom', 'pendingUpdateFrom'] as const)
				expect(Object.keys(inputs[map] ?? {})).toHaveLength(Object.keys(inputs.working).length);
		}
	});

	it('would have been five times the realtime per-message limit as whole live state', () => {
		// The defect, stated as a number, so a change that quietly made the old shape
		// smaller could not be mistaken for having fixed it.
		//
		// Larger than the 253.3 KiB #95 measured, and the difference is not a
		// correction of that figure but a fuller state: this one fills all five Graphic
		// Input value maps — `overrides`, `updateFrom`, and `pendingUpdateFrom` as well
		// as `working` and `accepted` — at maximal Broadcast Graphic ids and Graphic
		// Input keys, with the Screen's Graphic Source Selections populated too.
		const whole = realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', {
			screenId: 7,
			sessionId: 12,
			sequence: 4,
			commandType: 'Take',
			currentState: worst,
		} as never);

		expect(whole).toBe(361_780);
		expect(whole).toBeGreaterThan(MAX_REALTIME_MESSAGE_BYTES * 5);
	});

	it('keeps an on-air action on the fast path however much text the Broadcast Graphic holds', () => {
		// The reason the change names entries rather than whole Broadcast Graphics. An
		// Out changes a playout record and nothing else, so it stays a few hundred bytes
		// at the largest live session that exists — and an operator taking a graphic off
		// air never waits for a snapshot, on any show.
		const ids = Object.keys(worst.playout);
		const after = applyBroadcastGraphicsCommand(worst, { type: 'Out', payload: { graphicId: ids[0]! } }, {
			inputs: [],
			acceptedAt: 2_000,
			durations: { enter: 0, update: 10_000, exit: 500 },
		});

		const payload = payloadFor(worst, after, 'Out');

		expect(payload.change?.inputs).toBeUndefined();
		expect(messageBytes(payload)).toBe(280);
	});

	it('fits within the realtime per-message limit for every command the worst case admits', () => {
		const ids = Object.keys(worst.playout);
		const keys = Object.keys(worst.inputs[ids[0]!]!.working);
		const context = {
			inputs: declarations(keys),
			sources: [{ key: keys[0]!, label: keys[0]!, kind: 'player' as const }],
			bindings: keys.map(key => ({ inputKey: key, sourceKey: keys[0]!, fieldId: 'name' })),
			durations: { enter: 0, update: 10_000, exit: 500 },
		};

		const commands: BroadcastGraphicsCommandInput[] = [
			{ type: 'Out', payload: { graphicId: ids[0]! } },
			{ type: 'Set Input', payload: { graphicId: ids[0]!, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) } },
			{ type: 'Set Override', payload: { graphicId: ids[0]!, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) } },
			{ type: 'Select Source', payload: { graphicId: ids[0]!, sourceKey: keys[0]!, selectionId: 1 } },
		];

		for (const command of commands) {
			const after = applyBroadcastGraphicsCommand(worst, command, { ...context, acceptedAt: 2_000 });

			expect(messageBytes(payloadFor(worst, after))).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
		}
	});

	it('drops the change rather than the limit when one Broadcast Graphic’s Graphic Input state is too large', () => {
		// A maximally-declared Broadcast Graphic's Graphic Input state exceeds the limit
		// on its own, so no description of the difference can fit. The notification says
		// only that the order advanced, and the peer reloads — which is what makes the
		// message bounded by construction rather than by argument.
		const ids = Object.keys(worst.playout);
		const keys = Object.keys(worst.inputs[ids[0]!]!.working);
		const after = applyBroadcastGraphicsCommand(worst, {
			type: 'Set Input',
			payload: { graphicId: ids[0]!, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) },
		}, {
			inputs: declarations(keys),
			acceptedAt: 2_000,
		});

		expect(payloadFor(worst, after).change).toBeUndefined();
	});
});

describe('broadcastGraphicsCommandAppliedPayload', () => {
	const before: BroadcastGraphicsLiveState = {
		playout: { bug: { onAir: true, effectiveStartedAt: 5, cut: false } },
		inputs: { bug: { working: { name: 'Bug' }, accepted: { name: 'Bug' }, acceptedRevision: 1 } },
		sources: {},
	};

	it('carries a change a peer can apply to land on exactly the committed state', () => {
		const after = applyBroadcastGraphicsCommand(before, { type: 'Take', payload: { graphicId: 'slate' } }, {
			inputs: [],
			acceptedAt: 1_000,
		});

		const payload = payloadFor(before, after);

		expect(payload.change).toBeDefined();
		expect(changedBroadcastGraphicsLiveState(before, payload.change!)).toEqual(after);
	});

	it('names the epoch and sequence a peer decides from, whether or not it carries a change', () => {
		const payload = payloadFor(undefined, before, 'Out');

		expect(payload).toMatchObject({ screenId: 7, sessionId: 12, sequence: 4, commandType: 'Out' });
		expect(payload.change).toBeUndefined();
	});

	it('carries no change when the command was a replay and there is no state it was reduced onto', () => {
		// A recognised repeat is answered with the current snapshot, which may be many
		// commands newer than the one being replayed — so there is no "before" to
		// describe a difference from, and inventing one would tell peers the order
		// advanced by a difference that is not the whole of it.
		expect(payloadFor(undefined, before).change).toBeUndefined();
	});

	it('carries no change when live state holds something a change cannot describe', () => {
		const unknown = { ...before, epoch: 'later' } as BroadcastGraphicsLiveState;

		expect(payloadFor(before, unknown).change).toBeUndefined();
	});

	it('carries an empty change when an accepted command left live state exactly as it was', () => {
		// Not the same as carrying none: the peer still advances its sequence in place
		// rather than fetching a snapshot it already has.
		expect(payloadFor(before, before).change).toEqual({});
	});
});

/**
 * What the change actually costs, and where it stops being carried.
 *
 * #168's third acceptance criterion is that the round-trip cost of whatever
 * replaced the payload be measured rather than assumed. The cost is a snapshot
 * reload, and it is paid exactly when a notification carries no change — so these
 * pin where that boundary is, in the one dimension that moves it: how much text one
 * Broadcast Graphic's Graphic Inputs are holding.
 */
describe('the cost of carrying the change', () => {
	/**
	 * One Broadcast Graphic with `count` Graphic Inputs, every value map filled at
	 * maximal length, reached the same way the worst case reaches it.
	 */
	function fullyFilled(count: number) {
		const graphicId = 'g'.repeat(GRAPHIC_ID_LENGTH);
		const keys = inputKeys(count);
		let resolved = '1'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
		const context = () => ({
			inputs: declarations(keys),
			sources: [{ key: keys[0]!, label: keys[0]!, kind: 'player' as const }],
			bindings: keys.map(key => ({ inputKey: key, sourceKey: keys[0]!, fieldId: 'name' })),
			resolveBindings: () => Object.fromEntries(keys.map(key => [key, resolved])),
			durations: { enter: 0, update: 10_000, exit: 500 },
		});

		let state = createInitialBroadcastGraphicsLiveState();
		state = reduce(state, { type: 'Take', payload: { graphicId } }, context(), 1_000);
		resolved = '2'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
		state = reduce(state, { type: 'Update Graphic', payload: { graphicId, basedOnAcceptedRevision: 1 } }, context(), 1_100);
		resolved = '3'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
		state = reduce(state, { type: 'Update Graphic', payload: { graphicId, basedOnAcceptedRevision: 2 } }, context(), 1_200);
		for (const key of keys) {
			state = reduce(state, { type: 'Set Override', payload: { graphicId, inputKey: key, value: 'w'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) } }, context(), 1_300);
			state = reduce(state, { type: 'Set Input', payload: { graphicId, inputKey: key, value: 'w'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) } }, context(), 1_300);
		}

		const after = reduce(state, {
			type: 'Set Input',
			payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) },
		}, context(), 1_400);

		return payloadFor(state, after, 'Set Input');
	}

	it('carries a Graphic Input edit up to eleven maximal Graphic Inputs on one Broadcast Graphic', () => {
		expect(messageBytes(fullyFilled(11))).toBe(62_260);
		expect(fullyFilled(11).change).toBeDefined();
	});

	it('falls back to a snapshot reload from the twelfth', () => {
		// The whole cost of this design, named: a Broadcast Graphic holding twelve
		// Graphic Inputs with every one of their five value maps at maximal length pays
		// one snapshot fetch per Graphic Input edit, on every client watching that
		// Screen. That is 65 KB of text on a single graphic, and the snapshot it fetches
		// is larger again — so the reload is the cheaper of the two things that could
		// happen, and the alternative is the message not arriving at all.
		expect(fullyFilled(12).change).toBeUndefined();
		expect(messageBytes(fullyFilled(12))).toBe(106);
	});

	/** Six Broadcast Graphics, eight Graphic Inputs each, sixty-character values. */
	function realisticShow() {
		const keys = Array.from({ length: 8 }, (_, index) => `input${index}`);
		const context = {
			inputs: keys.map(key => ({
				key,
				label: key,
				type: 'text' as const,
				required: false,
				maxLength: 200,
				onAirUpdatePolicy: 'staged' as const,
			})),
			durations: { enter: 500, update: 300, exit: 500 },
		};

		let state = createInitialBroadcastGraphicsLiveState();
		for (let index = 0; index < 6; index++) {
			const graphicId = `graphic-${index}`;
			for (const key of keys)
				state = reduce(state, { type: 'Set Input', payload: { graphicId, inputKey: key, value: 'v'.repeat(60) } }, context, 1_000);
			state = reduce(state, { type: 'Take', payload: { graphicId } }, context, 1_000);
		}

		return { state, keys, context };
	}

	it('costs no round trip at all on a show anyone actually runs', () => {
		const { state, keys, context } = realisticShow();

		const whole = realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', {
			screenId: 7,
			sessionId: 12,
			sequence: 4,
			commandType: 'Take',
			currentState: state,
		} as never);
		const edit = payloadFor(state, reduce(state, {
			type: 'Set Input',
			payload: { graphicId: 'graphic-0', inputKey: keys[0]!, value: 'q'.repeat(60) },
		}, context, 2_000), 'Set Input');
		const off = payloadFor(state, reduce(state, {
			type: 'Out',
			payload: { graphicId: 'graphic-0' },
		}, context, 2_000), 'Out');

		// What the notification used to carry on every command, against what it carries now.
		expect(whole).toBe(7_906);
		expect(messageBytes(edit)).toBe(1_355);
		expect(messageBytes(off)).toBe(189);
		expect(edit.change).toBeDefined();
		expect(off.change).toBeDefined();
	});
});
