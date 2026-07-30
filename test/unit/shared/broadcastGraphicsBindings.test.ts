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
		// A fixed acceptance instant: none of these tests is about animation timing, but
		// the reducer needs one to stamp the phase it begins.
		acceptedAt: 1_700_000_000_000,
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

function setOverrideClaiming(
	state: BroadcastGraphicsLiveState,
	value: GraphicInputValue,
	basedOn: GraphicInputValue,
	ctx?: BroadcastGraphicsReductionContext,
) {
	return reduce(
		state,
		{ type: 'Set Override', payload: { graphicId: GRAPHIC, inputKey: 'name', value, basedOn: { value: basedOn } } },
		ctx,
	);
}

function setInputClaiming(
	state: BroadcastGraphicsLiveState,
	value: GraphicInputValue,
	basedOn: GraphicInputValue,
	ctx?: BroadcastGraphicsReductionContext,
) {
	return reduce(
		state,
		{ type: 'Set Input', payload: { graphicId: GRAPHIC, inputKey: 'name', value, basedOn: { value: basedOn } } },
		ctx,
	);
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
		// is authored placeholder text and must not reach program dressed as live data,
		// so the key is absent — both in what acceptance stored and in what the values
		// the compositor reads report. An optional input has no `blocksTake` shielding
		// it, so this is the only thing standing between a placeholder and program.
		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({});
		expect(acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toEqual({});
		expect('name' in acceptedGraphicInputValues(state, GRAPHIC, [NAME])).toBe(false);
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
		// binding is simply unavailable — and the same input read as on air would be
		// stale instead.
		expect(trace!.status).toBe('unavailable');
		expect(traces(state, required, true)[0]!.status).toBe('stale');
	});

	it('refuses to take a graphic again once a required binding has stopped resolving', () => {
		const required = context({ inputs: [REQUIRED_NAME] });
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1, required), required);
		state = reduce(state, { type: 'Out', payload: { graphicId: GRAPHIC } }, required);
		state = selectPlayer(state, null, required);

		// The value it was last on air with belonged to a Player nobody has selected any
		// more. Taking it again would put a dead name on program with no warning, so the
		// off-air rule applies: a required unavailable input blocks the Take.
		expect(traces(state, required, false)[0]!.blocksTake).toBe(true);

		const failure = rejection(() => take(state, required));

		expect(failure.code).toBe('required-input-unavailable');
		expect(failure.inputKeys).toEqual(['name']);
	});

	it('drops an optional value whose binding has stopped resolving when retaken', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });

		state = reduce(state, { type: 'Out', payload: { graphicId: GRAPHIC } });
		state = selectPlayer(state, null);
		state = take(state);

		// Nothing blocks an optional input, so the only protection is that a Take
		// composes afresh: the stale name is gone rather than silently re-taken.
		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({});
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

describe('field Ownership over the values a binding sits above', () => {
	it('judges a claim against the resolved bound value an operator was shown', () => {
		const state = selectPlayer(createInitialBroadcastGraphicsLiveState(), 1);

		// The operator read 'Ava Reed' in the field, which is the binding's value and not
		// the working value underneath it. A claim naming what they saw is accepted.
		const accepted = setOverrideClaiming(state, 'Ava "Riptide" Reed', 'Ava Reed');

		expect(broadcastGraphicInputsState(accepted, GRAPHIC).overrides)
			.toEqual({ name: 'Ava "Riptide" Reed' });

		// A claim naming the working value beneath the binding — which is what the old
		// rule compared against, and which no operator was ever shown — is refused.
		const failure = rejection(() => setOverrideClaiming(state, 'Ava "Riptide" Reed', 'Unnamed'));

		expect(failure.code).toBe('stale-input-edit');
	});

	it('refuses a second operator\'s override of a field already overridden', () => {
		let state = selectPlayer(createInitialBroadcastGraphicsLiveState(), 1);
		state = setOverrideClaiming(state, 'Ava "Riptide" Reed', 'Ava Reed');

		// A colleague still looking at the resolved value makes the claim they were shown.
		// It lost the race, and is told so rather than silently winning it.
		const failure = rejection(() => setOverrideClaiming(state, 'A. Reed', 'Ava Reed', context()));

		expect(failure.code).toBe('stale-input-edit');
		expect(broadcastGraphicInputsState(state, GRAPHIC).overrides)
			.toEqual({ name: 'Ava "Riptide" Reed' });
	});

	it('never refuses a clear, which removes a mask rather than replacing a value', () => {
		let state = selectPlayer(createInitialBroadcastGraphicsLiveState(), 1);
		state = setOverrideClaiming(state, 'Ava "Riptide" Reed', 'Ava Reed');
		// The selection moves under the override, so no claim anyone could make about the
		// shown value still holds — and clearing must work anyway.
		state = selectPlayer(state, 2);

		const cleared = setOverride(state, null);

		expect(broadcastGraphicInputsState(cleared, GRAPHIC).overrides).toEqual({});
	});

	it('judges an unbound input\'s claim against its working value, as it always did', () => {
		const unbound = context({ bindings: [] });
		const state = createInitialBroadcastGraphicsLiveState();

		// Unedited, so the shown value is the declared default — the case a second
		// operator's first edit falls into.
		const accepted = setInputClaiming(state, 'Ava Reed', 'Unnamed', unbound);

		expect(broadcastGraphicInputsState(accepted, GRAPHIC).working).toEqual({ name: 'Ava Reed' });
		expect(rejection(() => setInputClaiming(accepted, 'Someone else', 'Unnamed', unbound)).code)
			.toBe('stale-input-edit');
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

	it('refuses an override on a Graphic Input with no binding to mask', () => {
		const unbound = context({ bindings: [] });

		const failure = rejection(() => setOverride(createInitialBroadcastGraphicsLiveState(), 'Ava Reed', unbound));

		// An override masks a binding. With no binding it would be a second way to hold a
		// value with no rule saying which wins, so the working value is the only way in.
		expect(failure.code).toBe('override-unbound');
	});

	it('still clears an override whose binding an author has since removed', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'Ava "Riptide" Reed');

		// The author removes the binding under the running show. The override stands,
		// because precedence is override-first — so the operator must still be able to
		// take the mask off.
		const unbound = context({ bindings: [] });
		const cleared = setOverride(state, null, unbound);

		expect(broadcastGraphicInputsState(cleared, GRAPHIC).overrides).toEqual({});
	});

	it('refuses an override naming a Graphic Input the Broadcast Graphic does not declare', () => {
		const failure = rejection(() => reduce(
			createInitialBroadcastGraphicsLiveState(),
			{ type: 'Set Override', payload: { graphicId: GRAPHIC, inputKey: 'ghost', value: 'x' } },
		));

		expect(failure.code).toBe('unknown-input');
	});

	it('reads an unusable override as unavailable rather than stale', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'A'.repeat(80));

		const [trace] = traces(state, context(), true);

		// The binding is still resolving and program still shows the last accepted value,
		// which is the shape of stale — but the cause is the operator's own unusable
		// entry, and calling that stale would point them at the data source instead of at
		// the value they need to fix.
		expect(trace!.accepted.value).toBe('Ava Reed');
		expect(trace!.bound!.value).toBe('Ava Reed');
		expect(trace!.status).toBe('unavailable');
	});

	it('leaves an unavailable override off air rather than coercing it', () => {
		let state = take(selectPlayer(createInitialBroadcastGraphicsLiveState(), 1));
		state = setOverride(state, 'A'.repeat(80));
		state = updateGraphic(state, broadcastGraphicInputsState(state, GRAPHIC).acceptedRevision);

		expect(broadcastGraphicInputsState(state, GRAPHIC).accepted).toEqual({ name: 'Ava Reed' });
	});
});
