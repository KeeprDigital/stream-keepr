import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsReductionContext,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicInputValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	acceptedGraphicInputValues,
	applyBroadcastGraphicsCommand,
	broadcastGraphicInputsState,
	BroadcastGraphicsCommandRejection,
	broadcastGraphicSourceSelections,
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * Event Data binding through the Broadcast Graphics reducer.
 *
 * Every rule is stated as an operator meets it: they pick a Player once and the
 * bound fields fill; an override corrects one value without losing the feed; a
 * required field that cannot resolve refuses to go on air; and one that stops
 * resolving on air keeps showing what program committed to, marked as such.
 *
 * Event Data itself reaches the reducer as a resolver over Graphic Source
 * Selections, so these tests supply that resolver directly rather than a database
 * — the same seam the server fills with real Event Data.
 */

const GRAPHIC = 'lower-third';

const PLAYER_SOURCE = { key: 'player', label: 'Player', kind: 'player' } as const;

const NAME = {
	type: 'text',
	key: 'name',
	label: 'Name',
	required: false,
	updatePolicy: 'staged',
	default: 'Unnamed',
	maxLength: 40,
} as const;

const REQUIRED_NAME = { ...NAME, required: true } as const;
const LIVE_NAME = { ...NAME, updatePolicy: 'live' } as const;

const NAME_BINDING = { inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' } as const;

/** One Player per id, as the catalog reads Players. */
const PLAYERS: Record<number, string> = { 1: 'Ava Reed', 2: 'Sam Ortiz' };

/**
 * A reduction context whose bindings resolve the selected Player's name — the same
 * answer the shared catalog gives, supplied here without a database.
 */
function context(
	overrides: Partial<BroadcastGraphicsReductionContext> = {},
): BroadcastGraphicsReductionContext {
	return {
		inputs: [NAME],
		sources: [PLAYER_SOURCE],
		bindings: [NAME_BINDING],
		resolveBindings: (selections) => {
			const name = PLAYERS[selections.player ?? -1];
			return name === undefined ? {} : { name };
		},
		...overrides,
	};
}

function reduce(
	state: BroadcastGraphicsLiveState,
	command: BroadcastGraphicsCommandInput,
	ctx: BroadcastGraphicsReductionContext = context(),
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(state, command, ctx);
}

function selectPlayer(state: BroadcastGraphicsLiveState, id: number | null, ctx?: BroadcastGraphicsReductionContext) {
	return reduce(state, { type: 'Select Source', payload: { graphicId: GRAPHIC, sourceKey: 'player', selectionId: id } }, ctx);
}

function take(state: BroadcastGraphicsLiveState, ctx?: BroadcastGraphicsReductionContext) {
	return reduce(state, { type: 'Take', payload: { graphicId: GRAPHIC } }, ctx);
}

function setOverride(state: BroadcastGraphicsLiveState, value: GraphicInputValue, ctx?: BroadcastGraphicsReductionContext) {
	return reduce(state, { type: 'Set Override', payload: { graphicId: GRAPHIC, inputKey: 'name', value } }, ctx);
}

function updateGraphic(state: BroadcastGraphicsLiveState, basedOnAcceptedRevision: number, ctx?: BroadcastGraphicsReductionContext) {
	return reduce(state, { type: 'Update Graphic', payload: { graphicId: GRAPHIC, basedOnAcceptedRevision } }, ctx);
}

function traces(state: BroadcastGraphicsLiveState, ctx: BroadcastGraphicsReductionContext = context(), onAir = false) {
	const bound = ctx.resolveBindings?.(broadcastGraphicSourceSelections(state, GRAPHIC)) ?? {};
	return graphicInputTraces(
		state,
		GRAPHIC,
		{ inputs: ctx.inputs, bindings: ctx.bindings },
		bound,
		{ onAir },
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

describe('graphic Source Selection commands', () => {
	it('remembers which entity an operator selected, and forgets it when cleared', () => {
		let state = selectPlayer(createInitialBroadcastGraphicsLiveState(), 1);

		expect(broadcastGraphicSourceSelections(state, GRAPHIC)).toEqual({ player: 1 });

		state = selectPlayer(state, null);

		expect(broadcastGraphicSourceSelections(state, GRAPHIC)).toEqual({});
	});

	it('refuses a selection the Broadcast Graphic does not declare', () => {
		const failure = rejection(() => reduce(
			createInitialBroadcastGraphicsLiveState(),
			{ type: 'Select Source', payload: { graphicId: GRAPHIC, sourceKey: 'ghost', selectionId: 1 } },
		));

		expect(failure.code).toBe('unknown-source');
	});

	it('refuses a selection nobody picks, because it follows another', () => {
		const derived = context({
			sources: [PLAYER_SOURCE, { key: 'archetype', label: 'Archetype', kind: 'archetype', from: { sourceKey: 'player', relation: 'archetype' } }],
		});
		const failure = rejection(() => reduce(
			createInitialBroadcastGraphicsLiveState(),
			{ type: 'Select Source', payload: { graphicId: GRAPHIC, sourceKey: 'archetype', selectionId: 1 } },
			derived,
		));

		expect(failure.code).toBe('unknown-source');
	});
});

describe('bound Graphic Inputs on air', () => {
	it('takes the bound value on air rather than the declared default', () => {
		const state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));

		expect(acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({ name: 'Ava Reed' });
	});

	it('never falls back to the template default when its binding resolves nothing', () => {
		const state = take(createInitialBroadcastGraphicsLiveState());

		// Nothing is selected, so the binding resolves nothing. The default 'Unnamed'
		// is authored placeholder text and must not reach program dressed as live data.
		expect(acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({ name: 'Unnamed' });
		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({});
	});

	it('blocks Take while a required bound Graphic Input resolves nothing, and names it', () => {
		const required = context({ inputs: [REQUIRED_NAME] });
		const failure = rejection(() => take(createInitialBroadcastGraphicsLiveState(), required));

		expect(failure.code).toBe('required-input-unavailable');
		expect(failure.inputKeys).toEqual(['name']);
	});

	it('takes the graphic on air once its required binding resolves', () => {
		const required = context({ inputs: [REQUIRED_NAME] });
		const state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, required), required);

		expect(acceptedGraphicInputValues(state, GRAPHIC, [REQUIRED_NAME])).toEqual({ name: 'Ava Reed' });
	});

	it('holds a staged bound change until Update Graphic accepts it', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = selectPlayer(state, 2);

		// The operator changed the source of an on-air graphic. The input is staged, so
		// program still shows what it committed to.
		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });
		expect(traces(state, context(), true)[0]).toMatchObject({ pending: true, status: 'pending' });

		state = updateGraphic(state, broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Sam Ortiz' });
	});

	it('applies a live-policy bound change the moment the selection changes', () => {
		const live = context({ inputs: [LIVE_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, live), live);
		state = selectPlayer(state, 2, live);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Sam Ortiz' });
		// Its own field only: a staged acceptance another operator is preparing on this
		// graphic is not invalidated by it.
		expect(broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision).toBe(1);
	});

	it('holds the last accepted value, marked stale, when a required binding stops resolving on air', () => {
		const required = context({ inputs: [REQUIRED_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, required), required);
		state = selectPlayer(state, null, required);

		const [trace] = traces(state, required, true);

		expect(trace!.accepted.value).toBe('Ava Reed');
		expect(trace!.status).toBe('stale');
		// Update Graphic does not blank program either: acceptance passes over the
		// value it cannot resolve.
		state = updateGraphic(state, broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision, required);
		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });
	});

	it('reports unavailable rather than stale while the graphic is off', () => {
		const required = context({ inputs: [REQUIRED_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, required), required);
		state = reduce(state, { type: 'Out', payload: { graphicId: GRAPHIC } }, required);
		state = selectPlayer(state, null, required);

		const [trace] = traces(state, required, false);

		// Stale is about what program is showing, and program is showing nothing, so the
		// binding is simply unavailable. Take is not blocked, because the value this
		// graphic was legitimately last on air with is still what acceptance would
		// produce — blocking is for a required input with no value at all.
		expect(trace!.status).toBe('unavailable');
		expect(trace!.blocksTake).toBe(false);
		expect(traces(state, required, true)[0]!.status).toBe('stale');
	});
});

describe('re-resolving after an Event Data change', () => {
	/** The same Player, renamed under a running show. */
	function renamed(inputs = [LIVE_NAME]) {
		return context({
			inputs,
			resolveBindings: selections => (selections.player === 1 ? { name: 'Ava Reed-Marsh' } : {}),
		});
	}

	it('applies the re-resolved value immediately for a live On-air Update Policy input', () => {
		const live = context({ inputs: [LIVE_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, live), live);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });

		// Event Data moved without anyone issuing an operator action.
		state = reduce(state, { type: 'Resolve Bindings', payload: { graphicId: GRAPHIC } }, renamed());

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed-Marsh' });
	});

	it('leaves a staged input pending rather than accepting it', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = reduce(state, { type: 'Resolve Bindings', payload: { graphicId: GRAPHIC } }, renamed([NAME]));

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });
		expect(traces(state, renamed([NAME]), true)[0]).toMatchObject({ pending: true, status: 'pending' });
	});

	it('changes nothing while the Broadcast Graphic is off air', () => {
		const live = context({ inputs: [LIVE_NAME] });
		const off = selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, live);

		const resolved = reduce(off, { type: 'Resolve Bindings', payload: { graphicId: GRAPHIC } }, renamed());

		expect(broadcastGraphicInputsState(resolved, GRAPHIC).accepted).toEqual({});
	});

	it('reaches the same state however many times it is delivered', () => {
		const live = context({ inputs: [LIVE_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, live), live);
		state = reduce(state, { type: 'Resolve Bindings', payload: { graphicId: GRAPHIC } }, renamed());
		const once = broadcastGraphicInputsState(state, GRAPHIC);

		state = reduce(state, { type: 'Resolve Bindings', payload: { graphicId: GRAPHIC } }, renamed());

		// Two Live Controls watching the same change both send it, so it has to converge.
		expect(broadcastGraphicInputsState(state, GRAPHIC)).toEqual(once);
	});

	it('does not accept a re-resolved value an override is masking', () => {
		const live = context({ inputs: [LIVE_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, live), live);
		state = setOverride(state, 'Ava "Riptide" Reed', live);
		state = reduce(state, { type: 'Resolve Bindings', payload: { graphicId: GRAPHIC } }, renamed());

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava "Riptide" Reed' });
	});
});

describe('graphic Input Overrides', () => {
	it('masks its binding while the binding keeps resolving underneath', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'Ava "Riptide" Reed');

		const [trace] = traces(state, context(), true);

		expect(trace!.effective).toMatchObject({ value: 'Ava "Riptide" Reed', source: 'override' });
		// The binding is still resolving, and Live Control still shows what it resolves.
		expect(trace!.bound!.value).toBe('Ava Reed');
		expect(trace!.status).toBe('overridden');
	});

	it('puts the override on air through the ordinary acceptance', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'Ava "Riptide" Reed');
		state = updateGraphic(state, broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava "Riptide" Reed' });
	});

	it('resumes the current bound value when cleared, not the one it masked', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'Ava "Riptide" Reed');
		// The source moves on underneath the override, which is what "keeps resolving"
		// means: clearing resumes what the binding resolves now.
		state = selectPlayer(state, 2);
		state = setOverride(state, null);

		expect(traces(state, context(), true)[0]!.effective)
			.toMatchObject({ value: 'Sam Ortiz', source: 'bound' });
	});

	it('persists across a hide and show cycle until it is cleared', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'Ava "Riptide" Reed');
		state = reduce(state, { type: 'Out', payload: { graphicId: GRAPHIC } });
		state = take(state);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava "Riptide" Reed' });
	});

	it('lets an override rescue a required Graphic Input whose binding resolves nothing', () => {
		const required = context({ inputs: [REQUIRED_NAME] });
		const state = take(setOverride(createInitialBroadcastGraphicsLiveState(), 'Ava Reed', required), required);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });
	});

	it('applies a live-policy override immediately on an on-air graphic', () => {
		const live = context({ inputs: [LIVE_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, live), live);
		state = setOverride(state, 'Ava "Riptide" Reed', live);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava "Riptide" Reed' });
	});

	it('refuses an override naming a Graphic Input the Broadcast Graphic does not declare', () => {
		const failure = rejection(() => reduce(
			createInitialBroadcastGraphicsLiveState(),
			{ type: 'Set Override', payload: { graphicId: GRAPHIC, inputKey: 'ghost', value: 'x' } },
		));

		expect(failure.code).toBe('unknown-input');
	});

	it('leaves an unavailable override off air rather than coercing it', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'A'.repeat(80));
		state = updateGraphic(state, broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });
	});
});
