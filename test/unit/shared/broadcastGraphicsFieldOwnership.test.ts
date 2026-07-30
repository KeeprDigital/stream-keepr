import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicInputDeclaration, GraphicInputValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	BroadcastGraphicsCommandRejection,
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
	workingGraphicInputValues,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * Two operators on one Broadcast Graphic.
 *
 * The settled rule is field-scoped: edits to different Graphic Inputs merge, and
 * an edit to the same Graphic Input that was built against a value another
 * operator has since replaced is rejected rather than silently overwriting it.
 * A Set Input therefore states the value it believes it is replacing — that
 * belief is its Field Ownership claim, and this is where it is honoured.
 */

const NAME: GraphicInputDeclaration = {
	type: 'text',
	key: 'name',
	label: 'Name',
	required: false,
	updatePolicy: 'staged',
	default: 'Unnamed',
	maxLength: 20,
};

const TITLE: GraphicInputDeclaration = {
	type: 'text',
	key: 'title',
	label: 'Title',
	required: false,
	updatePolicy: 'staged',
	default: '',
	maxLength: 20,
};

const DECLARATIONS = [NAME, TITLE];
const GRAPHIC = 'lower-third';

/**
 * A fixed authoritative clock, so nothing here depends on wall time.
 *
 * Set Input never reads it — it writes no playout record — but the reduction
 * context requires it, and supplying a real one keeps these cases honest if a
 * later reducer starts stamping input acceptance the way playout is stamped.
 */
const T0 = 1_700_000_000_000;

function setInput(
	state: BroadcastGraphicsLiveState,
	inputKey: string,
	value: GraphicInputValue,
	basedOn?: { value: GraphicInputValue },
): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(
		state,
		{ type: 'Set Input', payload: { graphicId: GRAPHIC, inputKey, value, basedOn } } as BroadcastGraphicsCommandInput,
		{ inputs: DECLARATIONS, acceptedAt: T0 },
	);
}

function working(state: BroadcastGraphicsLiveState): Record<string, GraphicInputValue> {
	return workingGraphicInputValues(state, GRAPHIC, DECLARATIONS);
}

describe('broadcastGraphicsFieldOwnership', () => {
	it('accepts an edit whose claim matches the value it replaces', () => {
		const state = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });

		expect(working(state).name).toBe('Ava Reed');
	});

	it('reads an unedited Graphic Input as its declared default when checking the claim', () => {
		// Nothing is stored for an input nobody has edited, so the value an operator
		// sees — and therefore claims — is the declaration's default rather than
		// absence. Comparing against absence would refuse every first edit.
		const state = setInput(createInitialBroadcastGraphicsLiveState(), 'title', 'Champion', { value: '' });

		expect(working(state).title).toBe('Champion');
	});

	it('rejects an edit whose claim names a value another operator has replaced', () => {
		const first = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });

		// The second operator's Live Control still showed the default when they typed.
		expect(() => setInput(first, 'name', 'Ben Cole', { value: 'Unnamed' }))
			.toThrow(BroadcastGraphicsCommandRejection);
	});

	it('leaves the first operator’s value in place when it rejects the stale edit', () => {
		const first = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });

		try {
			setInput(first, 'name', 'Ben Cole', { value: 'Unnamed' });
		}
		catch {}

		expect(working(first).name).toBe('Ava Reed');
	});

	it('names the refusal so the operator can be told what happened', () => {
		const first = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });

		expect(() => setInput(first, 'name', 'Ben Cole', { value: 'Unnamed' }))
			.toThrow(expect.objectContaining({ code: 'stale-input-edit', inputKeys: ['name'] }));
	});

	it('merges concurrent edits to different Graphic Inputs', () => {
		// Disjoint Field Ownership: each operator claims one field, neither claim is
		// invalidated by the other, and both edits survive.
		let state = createInitialBroadcastGraphicsLiveState();
		state = setInput(state, 'name', 'Ava Reed', { value: 'Unnamed' });
		state = setInput(state, 'title', 'Champion', { value: '' });

		expect(working(state)).toEqual({ name: 'Ava Reed', title: 'Champion' });
	});

	it('accepts a restatement of the same value as the same edit rather than a conflict', () => {
		// Two operators typing the same value have nothing to disagree about; refusing
		// here would report a conflict where no value is being overwritten.
		const first = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });
		const again = setInput(first, 'name', 'Ava Reed', { value: 'Ava Reed' });

		expect(working(again).name).toBe('Ava Reed');
	});

	it('writes without a claim when the command makes none', () => {
		// An edit that states no belief about the prior value is claiming nothing, so
		// there is nothing to refuse. Live Control always states one; this keeps the
		// guard a property of the claim rather than of the route.
		const first = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });
		const overwritten = setInput(first, 'name', 'Ben Cole');

		expect(working(overwritten).name).toBe('Ben Cole');
	});

	it('compares a media Graphic Input claim by its pinned identity and revision', () => {
		const media: GraphicInputDeclaration = {
			type: 'media',
			key: 'badge',
			label: 'Badge',
			required: false,
			updatePolicy: 'staged',
			default: null,
			mediaKind: 'image',
		};
		const pinned = { assetId: 'asset-1', revisionId: 'rev-1' };
		const state = applyBroadcastGraphicsCommand(
			createInitialBroadcastGraphicsLiveState(),
			{ type: 'Set Input', payload: { graphicId: GRAPHIC, inputKey: 'badge', value: pinned } } as BroadcastGraphicsCommandInput,
			{ inputs: [media], acceptedAt: T0 },
		);

		// A structurally equal reference is the same claim even though it is a
		// different object, which is exactly what arrives over the wire.
		expect(() => applyBroadcastGraphicsCommand(
			state,
			{
				type: 'Set Input',
				payload: {
					graphicId: GRAPHIC,
					inputKey: 'badge',
					value: null,
					basedOn: { value: { assetId: 'asset-1', revisionId: 'rev-1' } },
				},
			} as BroadcastGraphicsCommandInput,
			{ inputs: [media], acceptedAt: T0 },
		)).not.toThrow();
	});

	describe('what Live Control shows about a refused edit', () => {
		it('marks a Graphic Input superseded so a refreshed field is not read as the operator’s own', () => {
			const state = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });

			const [name, title] = graphicInputTraces(
				state,
				GRAPHIC,
				{ inputs: DECLARATIONS, acceptedAt: T0 },
				{},
				['name'],
			);

			expect(name!.status).toBe('superseded');
			expect(title!.status).not.toBe('superseded');
		});

		it('still reports the authoritative value behind a superseded field', () => {
			const state = setInput(createInitialBroadcastGraphicsLiveState(), 'name', 'Ava Reed', { value: 'Unnamed' });

			const [name] = graphicInputTraces(state, GRAPHIC, { inputs: DECLARATIONS }, {}, ['name']);

			// Superseded is a fact about whose edit won, not about the value: the operator
			// has to be able to read what is there now in order to redo their change.
			expect(name!.working.value).toBe('Ava Reed');
		});

		it('reports no Graphic Input as superseded when none was refused', () => {
			const traces = graphicInputTraces(
				createInitialBroadcastGraphicsLiveState(),
				GRAPHIC,
				{ inputs: DECLARATIONS, acceptedAt: T0 },
			);

			expect(traces.every(trace => trace.status !== 'superseded')).toBe(true);
		});
	});
});
