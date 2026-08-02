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
 * How a fixed number of things is spread as evenly as possible over the first
 * `carriers` Broadcast Graphics.
 *
 * The arrangement is a variable rather than a choice, because which one is dearest
 * is a question to be measured. It is not obvious in either direction: spreading
 * cannot add a single stored value, since the Screen-wide caps fix how many there
 * are, and it cannot add a playout record either, since every placed Broadcast
 * Graphic has one whatever it declares — so the whole difference is in how many
 * records* carry those values, and what each record costs in keys.
 *
 * Answering with fewer than `total` would quietly measure a smaller Screen, so it
 * refuses instead: a fixture that loses ten Graphic Inputs and reports a comfortable
 * figure is the failure this whole measurement exists to avoid.
 */
function spread(total: number, carriers: number, perGraphic: number): number[] {
	if (carriers * perGraphic < total)
		throw new Error(`${carriers} Broadcast Graphics cannot carry ${total} at ${perGraphic} each`);

	return Array.from(
		{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
		(_, index) => index >= carriers
			? 0
			: Math.floor(total / carriers) + (index < total % carriers ? 1 : 0),
	);
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
 * A live state at the Screen-wide caps, driven through the reducer, with the Graphic
 * Inputs and Graphic Source Selections arranged as asked.
 *
 * Per Broadcast Graphic, in order: every declared Graphic Input bound and resolving a
 * maximal authored value, then taken on air, so `accepted` is full; the Event Data
 * underneath moved and accepted twice with an update still in flight, so `updateFrom`
 * and `pendingUpdateFrom` are both full; then a Graphic Input Override and a working
 * value at the full wire length, which the declaration's own `maxLength` makes
 * unavailable and acceptance therefore passes over — which is exactly why those two
 * may be longer than anything that reaches air.
 */
function liveStateAtCaps(
	/** How many Broadcast Graphics the Screen's Graphic Inputs are shared between. */
	inputCarriers: number,
	/** How many Broadcast Graphics its Graphic Source Selections are shared between. */
	sourceCarriers: number,
): BroadcastGraphicsLiveState {
	const ids = graphicIds(MAX_BROADCAST_GRAPHICS_PER_SCREEN);
	const inputCounts = spread(
		MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
		inputCarriers,
		MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
	);
	const sourceCounts = spread(
		MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
		sourceCarriers,
		MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	);
	const authored = 'a'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	const wire = 'w'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH);
	let state = createInitialBroadcastGraphicsLiveState();

	ids.forEach((graphicId, index) => {
		const keys = inputKeys(inputCounts[index]!);
		const sourceKeys = inputKeys(Math.max(sourceCounts[index]!, 1));
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

		for (const sourceKey of sourceKeys.slice(0, sourceCounts[index]!))
			state = reduce(state, { type: 'Select Source', payload: { graphicId, sourceKey, selectionId: 999_999 } }, context, 900);

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

/** How large the old whole-live-state notification would have been for a state. */
function wholeStateBytes(state: BroadcastGraphicsLiveState): number {
	return realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', {
		screenId: 7,
		sessionId: 12,
		sequence: 4,
		commandType: 'Take',
		currentState: state,
	} as never);
}

/**
 * The dearest arrangement the Screen-wide caps admit — measured, not chosen.
 *
 * Spread as widely as the caps allow — the Screen's sixty Graphic Inputs over all
 * fifty Broadcast Graphics, its forty Graphic Source Selections over forty of them —
 * because that maximises the number of *records* holding a fixed number of values.
 * Every record costs a maximal-length Broadcast Graphic id for its key, and a Graphic
 * Input record holding at least one input additionally carries the `updateFrom` and
 * `pendingUpdateFrom` field names that an input-less one never gets.
 *
 * This is the correction #168's review caught. The first fixture packed the inputs
 * into as few graphics as the per-graphic cap allowed and justified it by saying an
 * input-less graphic "costs only its playout record" — which is true and irrelevant,
 * because those graphics exist in every arrangement. The pinned figure was 361,780,
 * some 5,273 bytes under the real worst case.
 */
function worstCaseLiveState(): BroadcastGraphicsLiveState {
	return liveStateAtCaps(50, 40);
}

/**
 * The same caps, packed into as few Broadcast Graphics as they allow.
 *
 * Cheaper as a whole live state and dearer as a *change*, which is the distinction
 * that matters: a notification carries one graphic's records, so what bounds it is
 * the largest single Graphic Input record a Screen can hold, not the largest Screen.
 */
function concentratedLiveState(): BroadcastGraphicsLiveState {
	return liveStateAtCaps(3, 5);
}

/** The Broadcast Graphic carrying the most Graphic Inputs, which a change costs most for. */
function richestGraphicId(state: BroadcastGraphicsLiveState): string {
	return Object.entries(state.inputs)
		.sort(([, a], [, b]) => Object.keys(b.working).length - Object.keys(a.working).length)[0]![0];
}

/**
 * One Broadcast Graphic with `count` Graphic Inputs, every value map filled at
 * maximal length, reached the same way the worst case reaches it — plus any
 * `padding` inputs that only ever received a working value.
 *
 * The padding exists so a fixture can be tuned to the byte: the fully-filled inputs
 * move the total in steps of about 5.6 KB, which is far too coarse to land inside
 * the margin an envelope occupies.
 */
function fullyFilledState(count: number, padding: readonly number[] = []) {
	const graphicId = 'g'.repeat(GRAPHIC_ID_LENGTH);
	const keys = inputKeys(count);
	const paddingKeys = inputKeys(count + padding.length).slice(count);
	let resolved = '1'.repeat(MAX_GRAPHIC_TEXT_LENGTH);
	const context = () => ({
		inputs: declarations([...keys, ...paddingKeys]),
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
	paddingKeys.forEach((key, index) => {
		state = reduce(state, { type: 'Set Input', payload: { graphicId, inputKey: key, value: 'p'.repeat(padding[index]!) } }, context(), 1_350);
	});

	return { graphicId, keys, paddingKeys, context, state };
}

/** One Graphic Input edit on a fully-filled Broadcast Graphic, as it is published. */
function fullyFilled(count: number) {
	const { graphicId, keys, context, state } = fullyFilledState(count);
	const after = reduce(state, {
		type: 'Set Input',
		payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) },
	}, context(), 1_400);

	return payloadFor(state, after, 'Set Input');
}

/**
 * A Graphic Input edit whose change is the largest one that still fits.
 *
 * Tuned by search rather than by a written-down length, so it stays at the boundary
 * when anything about the encoding moves. At the value it finds, one more byte does
 * not fit — which is what makes it able to tell apart a guard that measures the
 * complete message from one that measures only the change it carries.
 */
function atTheCarryingBoundary() {
	const fits = (padding: number): boolean => {
		const { graphicId, keys, context, state } = fullyFilledState(11, [MAX_GRAPHIC_INPUT_VALUE_LENGTH, MAX_GRAPHIC_INPUT_VALUE_LENGTH, padding]);
		const command = {
			type: 'Set Input',
			payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) },
		} as const;
		const after = applyBroadcastGraphicsCommand(state, command, context());
		return payloadFor(state, after, 'Set Input').change !== undefined;
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

	const { graphicId, keys, context, state } = fullyFilledState(11, [MAX_GRAPHIC_INPUT_VALUE_LENGTH, MAX_GRAPHIC_INPUT_VALUE_LENGTH, low]);
	return {
		state,
		command: {
			type: 'Set Input',
			payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) },
		} as BroadcastGraphicsCommandInput,
		context: context(),
	};
}

describe('the commandApplied notification at the largest live session the caps admit', () => {
	const worst = worstCaseLiveState();
	const concentrated = concentratedLiveState();

	it('is built from a live state that fills every cap the Screen has', () => {
		// Guards the measurement itself. A builder that quietly stopped filling one of
		// the five value maps, or that placed fifty of the sixty Graphic Inputs because
		// its arrangement could not fit them, would report a comfortable figure for a
		// smaller Screen — and the second of those is not hypothetical, it is what the
		// first attempt at sweeping arrangements here actually did.
		const filled = Object.values(worst.inputs);
		const inputCount = filled.reduce((total, inputs) => total + Object.keys(inputs.working).length, 0);
		const sourceCount = Object.values(worst.sources ?? {})
			.reduce((total, selections) => total + Object.keys(selections).length, 0);

		expect(Object.keys(worst.playout)).toHaveLength(MAX_BROADCAST_GRAPHICS_PER_SCREEN);
		expect(inputCount).toBe(MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN);
		expect(sourceCount).toBe(MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN);
		for (const inputs of filled) {
			for (const map of ['working', 'overrides', 'accepted', 'updateFrom', 'pendingUpdateFrom'] as const)
				expect(Object.keys(inputs[map] ?? {})).toHaveLength(Object.keys(inputs.working).length);
		}
	});

	it('is the dearest arrangement the caps admit, which is measured rather than chosen', () => {
		// Spreading a fixed number of Graphic Inputs and Graphic Source Selections over
		// more Broadcast Graphics cannot add a stored value and cannot add a playout
		// record — every placed graphic has one either way. What it adds is *records*:
		// one more maximal-length Broadcast Graphic id as a key, and, for a Graphic Input
		// record that holds at least one input, the `updateFrom` and `pendingUpdateFrom`
		// field names an input-less record never carries.
		//
		// The first fixture here packed them into as few graphics as the per-graphic caps
		// allowed and justified it with the opposite reasoning — that an input-less
		// graphic "costs only its playout record", which is true and says nothing, since
		// those graphics are present in every arrangement. It landed on 361,780, which
		// this sweep shows is the *cheapest* admissible arrangement rather than the
		// dearest.
		// The two near-neighbours are the load-bearing ones: one fewer carrier of either
		// kind is already cheaper, so the arrangement this fixture uses is a peak rather
		// than merely a high point somebody liked.
		const alternatives = [
			[49, 40],
			[50, 39],
			[3, 5],
			[3, 40],
			[5, 5],
			[12, 20],
			[25, 20],
			[50, 5],
		] as const;

		for (const [inputCarriers, sourceCarriers] of alternatives)
			expect(wholeStateBytes(liveStateAtCaps(inputCarriers, sourceCarriers))).toBeLessThan(wholeStateBytes(worst));

		expect(wholeStateBytes(liveStateAtCaps(3, 5))).toBe(361_780);
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

		expect(whole).toBe(367_053);
		expect(whole).toBeGreaterThan(MAX_REALTIME_MESSAGE_BYTES * 5);
	});

	it('keeps an on-air action on the fast path however much text the Broadcast Graphic holds', () => {
		// The reason the change names entries rather than whole Broadcast Graphics. An
		// Out changes a playout record and nothing else, so it stays a few hundred bytes
		// at the largest live session that exists — and an operator taking a graphic off
		// air never waits for a snapshot, on any show.
		const after = applyBroadcastGraphicsCommand(worst, { type: 'Out', payload: { graphicId: richestGraphicId(worst) } }, {
			inputs: [],
			acceptedAt: 2_000,
			durations: { enter: 0, update: 10_000, exit: 500 },
		});

		const payload = payloadFor(worst, after, 'Out');

		expect(payload.change?.inputs).toBeUndefined();
		expect(messageBytes(payload)).toBe(280);
	});

	it('fits within the realtime per-message limit for every command, in either arrangement', () => {
		// Both arrangements, because the dearest *whole live state* and the dearest
		// *single change* are not the same Screen. Spreading the Graphic Inputs over
		// every Broadcast Graphic maximises the total; concentrating them maximises one
		// graphic's own Graphic Input record, which is what a change actually carries.
		// Only the second can reach the limit, and testing only the first would have
		// asserted the bound against the arrangement that cannot break it.
		for (const state of [worst, concentrated]) {
			const graphicId = richestGraphicId(state);
			const keys = Object.keys(state.inputs[graphicId]!.working);
			const context = {
				inputs: declarations(keys),
				sources: [{ key: keys[0]!, label: keys[0]!, kind: 'player' as const }],
				bindings: keys.map(key => ({ inputKey: key, sourceKey: keys[0]!, fieldId: 'name' })),
				durations: { enter: 0, update: 10_000, exit: 500 },
			};

			const commands: BroadcastGraphicsCommandInput[] = [
				{ type: 'Out', payload: { graphicId } },
				{ type: 'Set Input', payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) } },
				{ type: 'Set Override', payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) } },
				{ type: 'Select Source', payload: { graphicId, sourceKey: keys[0]!, selectionId: 1 } },
			];

			for (const command of commands) {
				const after = applyBroadcastGraphicsCommand(state, command, { ...context, acceptedAt: 2_000 });

				expect(messageBytes(payloadFor(state, after))).toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
			}
		}
	});

	it('drops the change rather than the limit when one Broadcast Graphic’s Graphic Input state is too large', () => {
		// Twenty Graphic Inputs on one Broadcast Graphic, every value map full: the
		// record exceeds the limit on its own, so no description of the difference can
		// fit. The notification says only that the order advanced, and the peer reloads
		// — which is what makes the message bounded by construction rather than by
		// argument.
		const graphicId = richestGraphicId(concentrated);
		const keys = Object.keys(concentrated.inputs[graphicId]!.working);
		const after = applyBroadcastGraphicsCommand(concentrated, {
			type: 'Set Input',
			payload: { graphicId, inputKey: keys[0]!, value: 'x'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH) },
		}, {
			inputs: declarations(keys),
			acceptedAt: 2_000,
		});

		expect(payloadFor(concentrated, after).change).toBeUndefined();
	});

	it('measures the message it will actually publish, envelope and origin included', () => {
		// The guard compares against the *complete* message — `eventId`, `timestamp`,
		// and the origin connection id that echo suppression carries — because that is
		// what the transport sends and therefore what the provider measures. Asserted at
		// the boundary, where the envelope is the whole of the difference: the same
		// change fits without an origin connection id and does not fit with one, so a
		// guard that measured only the change, or that forgot the origin, would be
		// wrong here and nowhere else.
		const { state, command, context } = atTheCarryingBoundary();
		const after = applyBroadcastGraphicsCommand(state, command, context);
		const result = mapBroadcastGraphicsCommandResult(row(after), 'Set Input');
		const origin = 'c'.repeat(48);

		const bare = broadcastGraphicsCommandAppliedPayload(result, state);
		const echoed = broadcastGraphicsCommandAppliedPayload(result, state, origin);

		expect(bare.change).toBeDefined();
		expect(realtimeMessageBytes(3, 'broadcastGraphicsLiveSession:commandApplied', bare))
			.toBeLessThanOrEqual(MAX_REALTIME_MESSAGE_BYTES);
		expect(echoed.change).toBeUndefined();
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
	it('carries a Graphic Input edit up to eleven maximal Graphic Inputs on one Broadcast Graphic', () => {
		expect(messageBytes(fullyFilled(11))).toBe(62_260);
		expect(fullyFilled(11).change).toBeDefined();
	});

	/**
	 * A Take on a Broadcast Graphic whose Graphic Input record is already loaded.
	 *
	 * Off and on again rather than taken from nothing, because a Take composes its
	 * accepted values afresh but does not clear the working values and Graphic Input
	 * Overrides the record already holds — so what the notification carries is the whole
	 * record, not the acceptance.
	 */
	function retaken(count: number) {
		const { graphicId, context, state } = fullyFilledState(count);
		const off = reduce(state, { type: 'Out', payload: { graphicId, cut: true } }, context(), 1_400);

		return payloadFor(off, reduce(off, { type: 'Take', payload: { graphicId } }, context(), 1_500), 'Take');
	}

	it('carries a Take up to fourteen maximal Graphic Inputs on one Broadcast Graphic', () => {
		expect(messageBytes(retaken(14))).toBe(64_670);
		expect(retaken(14).change).toBeDefined();
	});

	it('falls back on a Take from the fifteenth, which is the on-air action paying the round trip', () => {
		// The honest limit of the argument this design rests on. An Out is cheap at any
		// size because it writes only a playout record, but a Take *accepts*, so it
		// carries the addressed graphic's whole Graphic Input record — and once that
		// record is large enough, the one action whose animation the fast path exists to
		// protect is the action that reloads.
		//
		// Legal: the per-graphic cap is 24. It needs fifteen Graphic Inputs each holding
		// maximal values in every map, which is around 80 KB of text on a single
		// Broadcast Graphic, and the entrance then starts part-played on outputs that
		// reload — exactly the cost this design rejected notification-only to avoid,
		// arriving at a size where nothing could have avoided it.
		expect(retaken(15).change).toBeUndefined();
		expect(messageBytes(retaken(15))).toBe(101);
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
