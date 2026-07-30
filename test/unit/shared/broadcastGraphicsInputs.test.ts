import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	acceptedGraphicInputValues,
	applyBroadcastGraphicsCommand,
	broadcastGraphicInputsState,
	BroadcastGraphicsCommandRejection,
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
	workingGraphicInputValues,
} from '~~/shared/modules/broadcast-graphics-live-session';

const NAME: GraphicInputDeclaration = {
	type: 'text',
	key: 'name',
	label: 'Name',
	required: false,
	updatePolicy: 'staged',
	default: 'Unnamed',
	maxLength: 20,
};

const REQUIRED_TITLE: GraphicInputDeclaration = {
	type: 'text',
	key: 'title',
	label: 'Title',
	required: true,
	updatePolicy: 'staged',
	default: '',
	maxLength: 20,
};

const LIVE_SCORE: GraphicInputDeclaration = {
	type: 'number',
	key: 'score',
	label: 'Score',
	required: false,
	updatePolicy: 'live',
	default: 0,
	integer: true,
	min: 0,
};

const GRAPHIC = 'lower-third';

function reduce(
	state: BroadcastGraphicsLiveState,
	command: BroadcastGraphicsCommandInput,
	inputs: readonly GraphicInputDeclaration[] = [NAME],
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(state, command, { inputs });
}

function take(state: BroadcastGraphicsLiveState, inputs?: readonly GraphicInputDeclaration[]) {
	return reduce(state, { type: 'Take', payload: { graphicId: GRAPHIC } }, inputs);
}

function setInput(
	state: BroadcastGraphicsLiveState,
	inputKey: string,
	value: unknown,
	inputs?: readonly GraphicInputDeclaration[],
) {
	return reduce(state, { type: 'Set Input', payload: { graphicId: GRAPHIC, inputKey, value } } as BroadcastGraphicsCommandInput, inputs);
}

function updateGraphic(
	state: BroadcastGraphicsLiveState,
	basedOnAcceptedRevision: number,
	cut = false,
	inputs?: readonly GraphicInputDeclaration[],
) {
	return reduce(
		state,
		{ type: 'Update Graphic', payload: { graphicId: GRAPHIC, cut, basedOnAcceptedRevision } },
		inputs,
	);
}

function rejection(action: () => unknown): BroadcastGraphicsCommandRejection {
	try {
		action();
	}
	catch (error) {
		if (error instanceof BroadcastGraphicsCommandRejection)
			return error;
		throw error;
	}
	throw new Error('expected the command to be rejected');
}

describe('broadcastGraphicsInputs', () => {
	it('starts a placed Broadcast Graphic at its declared Graphic Input defaults', () => {
		const state = createInitialBroadcastGraphicsLiveState();

		expect(workingGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({ name: 'Unnamed' });
		expect(acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({ name: 'Unnamed' });
		expect(broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision).toBe(0);
	});

	it('changes the working value without touching what is on air', () => {
		const edited = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed');

		expect(workingGraphicInputValues(edited, GRAPHIC, [NAME])).toEqual({ name: 'Ava Reed' });
		expect(broadcastGraphicInputsState(edited, GRAPHIC).accepted).toEqual({});
	});

	it('accepts the working values of an off Broadcast Graphic when it is taken on air', () => {
		let state = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed');
		state = take(state);

		expect(acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({ name: 'Ava Reed' });
		expect(broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision).toBe(1);
	});

	it('never leaks a staged edit on air through a repeated Take', () => {
		// Take restates a target-state intent. Were it also to accept staged values, a
		// second press on an already on-air graphic would be a backdoor Update Graphic
		// and partial edits would reach program without anyone confirming them.
		let state = take(createInitialBroadcastGraphicsLiveState());
		state = setInput(state, 'name', 'Half typed');
		const restated = take(state);

		expect(acceptedGraphicInputValues(restated, GRAPHIC, [NAME])).toEqual({ name: 'Unnamed' });
		expect(broadcastGraphicInputsState(restated, GRAPHIC).acceptedRevision).toBe(1);
	});

	it('blocks Take while a required Graphic Input has no available value, and names it', () => {
		const failure = rejection(() => take(createInitialBroadcastGraphicsLiveState(), [NAME, REQUIRED_TITLE]));

		expect(failure.code).toBe('required-input-unavailable');
		expect(failure.inputKeys).toEqual(['title']);
		expect(failure.message).toContain('Title');
	});

	it('takes the graphic on air once the required Graphic Input has an available value', () => {
		let state = setInput(createInitialBroadcastGraphicsLiveState(), 'title', 'Champion', [NAME, REQUIRED_TITLE]);
		state = take(state, [NAME, REQUIRED_TITLE]);

		expect(state.playout[GRAPHIC]).toMatchObject({ onAir: true, cut: false });
		expect(acceptedGraphicInputValues(state, GRAPHIC, [REQUIRED_TITLE])).toEqual({ title: 'Champion' });
	});

	it('accepts the complete staged set atomically through Update Graphic', () => {
		const inputs = [NAME, REQUIRED_TITLE];
		let state = setInput(createInitialBroadcastGraphicsLiveState(), 'title', 'Runner up', inputs);
		state = take(state, inputs);
		state = setInput(state, 'name', 'Ava Reed', inputs);
		state = setInput(state, 'title', 'Champion', inputs);

		// Neither edit is on air until one acceptance takes both.
		expect(acceptedGraphicInputValues(state, GRAPHIC, inputs))
			.toEqual({ name: 'Unnamed', title: 'Runner up' });

		const updated = updateGraphic(state, 1, false, inputs);

		expect(acceptedGraphicInputValues(updated, GRAPHIC, inputs))
			.toEqual({ name: 'Ava Reed', title: 'Champion' });
		expect(broadcastGraphicInputsState(updated, GRAPHIC).acceptedRevision).toBe(2);
	});

	it('rejects an Update Graphic built against an acceptance another operator has superseded', () => {
		let state = take(createInitialBroadcastGraphicsLiveState());
		state = setInput(state, 'name', 'First');
		state = updateGraphic(state, 1);
		state = setInput(state, 'name', 'Second');

		const failure = rejection(() => updateGraphic(state, 1));

		expect(failure.code).toBe('stale-input-acceptance');
		expect(acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({ name: 'First' });
	});

	it('offers no Update Graphic while the Broadcast Graphic is off', () => {
		const failure = rejection(() => updateGraphic(createInitialBroadcastGraphicsLiveState(), 0));

		expect(failure.code).toBe('update-unavailable');
	});

	it('reaches the same accepted values whether Update Graphic was cut or not', () => {
		let state = take(createInitialBroadcastGraphicsLiveState());
		state = setInput(state, 'name', 'Ava Reed');

		expect(updateGraphic(state, 1, true)).toEqual(updateGraphic(state, 1, false));
	});

	it('applies a live On-air Update Policy edit to an on-air graphic immediately', () => {
		const inputs = [LIVE_SCORE];
		let state = take(createInitialBroadcastGraphicsLiveState(), inputs);
		state = setInput(state, 'score', 3, inputs);

		expect(acceptedGraphicInputValues(state, GRAPHIC, inputs)).toEqual({ score: 3 });
		// A live edit accepts its own field only, so it never invalidates a staged
		// acceptance another operator is preparing.
		expect(broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision).toBe(1);
	});

	it('stages a live On-air Update Policy edit while the graphic is off', () => {
		const inputs = [LIVE_SCORE];
		const state = setInput(createInitialBroadcastGraphicsLiveState(), 'score', 3, inputs);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({});
		expect(acceptedGraphicInputValues(take(state, inputs), GRAPHIC, inputs)).toEqual({ score: 3 });
	});

	it('holds the last accepted value when a working value becomes unavailable', () => {
		const inputs = [NAME];
		let state = take(createInitialBroadcastGraphicsLiveState(), inputs);
		state = setInput(state, 'name', 'Ava Reed', inputs);
		state = updateGraphic(state, 1, false, inputs);

		// Longer than the declared bound: unavailable, so acceptance passes over it
		// rather than truncating it or blanking what program already shows.
		state = setInput(state, 'name', 'A'.repeat(50), inputs);
		state = updateGraphic(state, 2, false, inputs);

		expect(acceptedGraphicInputValues(state, GRAPHIC, inputs)).toEqual({ name: 'Ava Reed' });
	});

	it('rejects an edit to a Graphic Input this Broadcast Graphic does not declare', () => {
		const failure = rejection(() => setInput(createInitialBroadcastGraphicsLiveState(), 'ghost', 'x'));

		expect(failure.code).toBe('unknown-input');
	});

	it('forgets accepted values whose Graphic Input declaration has gone', () => {
		let state = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed');
		state = take(state);
		state = take(reduce(state, { type: 'Out', payload: { graphicId: GRAPHIC } }), []);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({});
	});

	it('leaves accepted values alone when the Broadcast Graphic goes off air', () => {
		let state = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed');
		state = take(state);
		const outed = reduce(state, { type: 'Out', payload: { graphicId: GRAPHIC } });

		expect(acceptedGraphicInputValues(outed, GRAPHIC, [NAME])).toEqual({ name: 'Ava Reed' });
		expect(broadcastGraphicInputsState(outed, GRAPHIC).acceptedRevision).toBe(1);
	});

	it('never mutates the state it reduces', () => {
		const initial = createInitialBroadcastGraphicsLiveState();
		const snapshot = structuredClone(initial);

		setInput(initial, 'name', 'Ava Reed');

		expect(initial).toEqual(snapshot);
	});

	it('traces the latest bound value, the working value, and the accepted on-air value apart', () => {
		let state = take(createInitialBroadcastGraphicsLiveState());
		state = setInput(state, 'name', 'Ava Reed');

		const [trace] = graphicInputTraces(state, GRAPHIC, {
			inputs: [NAME],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'displayName' }],
		});

		expect(trace!.working.value).toBe('Ava Reed');
		expect(trace!.accepted.value).toBe('Unnamed');
		expect(trace!.pending).toBe(true);
		expect(trace!.status).toBe('pending');
		// The binding is declared but nothing resolves it yet, so there is no latest
		// bound value to show — and an unresolved binding never falls back to the
		// template default.
		expect(trace!.bound).toBeUndefined();
	});

	it('reports an unavailable working value rather than a pending one', () => {
		let state = take(createInitialBroadcastGraphicsLiveState());
		state = setInput(state, 'name', 'A'.repeat(50));

		const [trace] = graphicInputTraces(state, GRAPHIC, { inputs: [NAME] });

		expect(trace!.status).toBe('unavailable');
		expect(trace!.working.availability).toEqual({ available: false, reason: 'Longer than 20 characters' });
	});

	it('reports which required Graphic Inputs block a Take, and why', () => {
		const blocked = graphicInputTraces(createInitialBroadcastGraphicsLiveState(), GRAPHIC, {
			inputs: [REQUIRED_TITLE],
		});

		expect(blocked[0]!.status).toBe('unavailable');
		expect(blocked[0]!.blocksTake).toBe(true);
	});
});
