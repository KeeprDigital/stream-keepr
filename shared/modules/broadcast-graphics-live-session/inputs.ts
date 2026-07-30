import type {
	GraphicInputBinding,
	GraphicInputDeclaration,
	GraphicInputValue,
} from '../../types/graphics';
import type {
	GraphicInputAvailability,
} from '../graphics';
import {
	findGraphicInputDeclaration,
	graphicInputAvailability,
} from '../graphics';

/**
 * The Graphic Input half of a Broadcast Graphics Live Session's state.
 *
 * ## Three values, not one
 *
 * A live operator has to be able to tell apart what a binding currently resolves,
 * what they have edited, and what program is actually showing. Those are three
 * distinct things and this module keeps them distinct:
 *
 * - the **latest bound value** is resolved from a Graphic Input Binding and is
 *   never stored here, because it follows Event Data rather than the Live
 *   Session;
 * - the **working value** is the server-accepted edit. It lives in the Live
 *   Session, so a second operator's Live Control sees it the moment it is
 *   accepted rather than when its author chooses to publish it;
 * - the **accepted on-air value** is what an on-air Broadcast Graphic renders.
 *   It changes only through an acceptance — Take for an off graphic, Update
 *   Graphic for an on-air one, or a live On-air Update Policy edit — so a partial
 *   edit can never leak on air.
 *
 * ## Why acceptance has its own revision
 *
 * `acceptedRevision` counts acceptances of the staged set, and Update Graphic
 * states the revision it was built against. Two operators editing one graphic
 * therefore cannot both accept: the second attempt names a revision that is no
 * longer current and is refused, which is the sequence guard the glossary
 * requires. It is a different mechanism from the Command Receipt that recognises
 * one operator's own retry, and neither substitutes for the other — the guard
 * refuses a *stale acceptance*, the receipt recognises a *repeated delivery* of
 * the same one.
 */

/** The Graphic Input values of one placed Broadcast Graphic. */
export interface BroadcastGraphicInputsState {
	/** Server-accepted edits, shared between sessions immediately. */
	working: Record<string, GraphicInputValue>;
	/** What an on-air Broadcast Graphic renders. */
	accepted: Record<string, GraphicInputValue>;
	/** How many times the staged set has been accepted, for the sequence guard. */
	acceptedRevision: number;
}

export function createInitialBroadcastGraphicInputsState(): BroadcastGraphicInputsState {
	return { working: {}, accepted: {}, acceptedRevision: 0 };
}

/** One Graphic Input's value with the judgement of whether it can be shown. */
export interface GraphicInputValueTrace {
	value: GraphicInputValue;
	availability: GraphicInputAvailability;
}

/**
 * What Live Control shows about one Graphic Input's value.
 *
 * `overridden` belongs to a Graphic Input Override, which masks a binding that keeps
 * resolving underneath it — there is nothing to mask until Graphic Input Bindings
 * resolve against Event Data, so it is still unreachable. Each status becomes
 * reachable with the capability that produces it, and shipping one no code path can
 * produce would be a state an operator could never be shown.
 *
 * ## Why this one is `superseded` rather than `stale`
 *
 * The spec says "stale" twice and means two different things by it. As a value-trace
 * status it means an on-air value whose source no longer provides it — program has
 * outlived its binding — and that meaning keeps the word. `superseded` is the other
 * one: this operator's last edit lost a field-scoped race, so the field has been
 * refreshed to the value that won.
 *
 * They need separate slots because **one input can be in both states at the same
 * instant** — on air, its binding dropped, and its last edit refused — and the
 * remedies are opposite: one says "your source moved on", the other says "look
 * again, someone beat you". Collapsing them would make the more urgent of the two
 * unsayable. `superseded` also reads against the Flight and Guarded Sequence
 * vocabulary, where superseding is already what a newer piece of work does to an
 * older one.
 *
 * The rejection code `stale-input-edit` deliberately keeps its own name: it is in a
 * different namespace and describes the *command's* fate rather than the value's.
 */
export const GRAPHIC_INPUT_STATUS_VALUES = ['manual', 'bound', 'pending', 'unavailable', 'superseded'] as const;

export type GraphicInputStatus = typeof GRAPHIC_INPUT_STATUS_VALUES[number];

/** What Live Control shows for one generated field. */
export interface GraphicInputTrace {
	declaration: GraphicInputDeclaration;
	/**
	 * The latest value this input's Graphic Input Binding resolves, when it has one
	 * and something resolved it. Resolving the curated field catalogue against
	 * current Event Data is not implemented yet, so a declared binding currently
	 * leaves this absent — and an unresolved binding never falls back to the
	 * template default.
	 */
	bound?: GraphicInputValueTrace;
	binding?: GraphicInputBinding;
	working: GraphicInputValueTrace;
	accepted: GraphicInputValueTrace;
	/** The working value differs from what is accepted on air. */
	pending: boolean;
	status: GraphicInputStatus;
	/** This required Graphic Input has no value that could go on air. */
	blocksTake: boolean;
}

/** The Graphic Input state of one placed Broadcast Graphic, empty until it has one. */
export function broadcastGraphicInputsState(
	state: { inputs?: Record<string, BroadcastGraphicInputsState> },
	graphicId: string,
): BroadcastGraphicInputsState {
	const stored = state.inputs?.[graphicId];
	if (!stored)
		return createInitialBroadcastGraphicInputsState();

	return {
		working: stored.working ?? {},
		accepted: stored.accepted ?? {},
		acceptedRevision: stored.acceptedRevision ?? 0,
	};
}

function resolveValues(
	stored: Record<string, GraphicInputValue>,
	declarations: readonly GraphicInputDeclaration[],
): Record<string, GraphicInputValue> {
	return Object.fromEntries(declarations.map(declaration => [
		declaration.key,
		declaration.key in stored ? stored[declaration.key]! : declaration.default,
	]));
}

/**
 * The values Live Control edits. An input nobody has edited resolves to its
 * declared default, which is what copying a Broadcast Graphic Template onto a
 * Screen means: the default becomes the placed graphic's initial manual value.
 */
export function workingGraphicInputValues(
	state: { inputs?: Record<string, BroadcastGraphicInputsState> },
	graphicId: string,
	declarations: readonly GraphicInputDeclaration[],
): Record<string, GraphicInputValue> {
	return resolveValues(broadcastGraphicInputsState(state, graphicId).working, declarations);
}

/** The values an on-air Broadcast Graphic renders. */
export function acceptedGraphicInputValues(
	state: { inputs?: Record<string, BroadcastGraphicInputsState> },
	graphicId: string,
	declarations: readonly GraphicInputDeclaration[],
): Record<string, GraphicInputValue> {
	return resolveValues(broadcastGraphicInputsState(state, graphicId).accepted, declarations);
}

/**
 * Accept the complete staged set.
 *
 * Only available values are accepted. An unavailable one is passed over rather
 * than coerced or blanked, which is what keeps an on-air value that has become
 * unavailable showing its last accepted rendering. Keys whose declaration has
 * gone are dropped, so acceptance also bounds what the Live Session stores.
 */
export function acceptGraphicInputValues(
	inputs: BroadcastGraphicInputsState,
	declarations: readonly GraphicInputDeclaration[],
): Record<string, GraphicInputValue> {
	const accepted: Record<string, GraphicInputValue> = {};

	for (const declaration of declarations) {
		const working = declaration.key in inputs.working
			? inputs.working[declaration.key]!
			: declaration.default;

		if (graphicInputAvailability(declaration, working).available) {
			accepted[declaration.key] = working;
			continue;
		}

		if (declaration.key in inputs.accepted)
			accepted[declaration.key] = inputs.accepted[declaration.key]!;
	}

	return accepted;
}

/**
 * The required Graphic Inputs with no value that could go on air.
 *
 * Measured against the values acceptance would actually produce rather than
 * against the working set alone: a required input whose new edit is unavailable
 * but whose accepted value still is available is not missing from program.
 */
export function unavailableRequiredGraphicInputs(
	inputs: BroadcastGraphicInputsState,
	declarations: readonly GraphicInputDeclaration[],
): GraphicInputDeclaration[] {
	const accepted = acceptGraphicInputValues(inputs, declarations);
	return declarations.filter(declaration =>
		declaration.required && !graphicInputAvailability(declaration, accepted[declaration.key]).available,
	);
}

/** What Live Control generates one field from, for every declared Graphic Input. */
export function graphicInputTraces(
	state: { inputs?: Record<string, BroadcastGraphicInputsState> },
	graphicId: string,
	graphic: {
		inputs?: readonly GraphicInputDeclaration[];
		bindings?: readonly GraphicInputBinding[];
	},
	/** The latest bound values, once something resolves Graphic Input Bindings. */
	boundValues: Readonly<Record<string, GraphicInputValue>> = {},
	/**
	 * The Graphic Inputs whose last edit from this session lost a field-scoped
	 * conflict.
	 *
	 * Client-side knowledge, not live state: whether *this* operator's edit was the
	 * one refused is a fact about this session, and a second operator looking at the
	 * same authoritative snapshot must not see their colleague's field — the one that
	 * won — marked as superseded.
	 */
	supersededInputKeys: readonly string[] = [],
): GraphicInputTrace[] {
	const declarations = graphic.inputs ?? [];
	const stored = broadcastGraphicInputsState(state, graphicId);
	const working = resolveValues(stored.working, declarations);
	const accepted = resolveValues(stored.accepted, declarations);

	return declarations.map((declaration) => {
		const binding = graphic.bindings?.find(entry => entry.inputKey === declaration.key);
		const hasBoundValue = declaration.key in boundValues;
		const workingTrace: GraphicInputValueTrace = {
			value: working[declaration.key]!,
			availability: graphicInputAvailability(declaration, working[declaration.key]),
		};
		const acceptedTrace: GraphicInputValueTrace = {
			value: accepted[declaration.key]!,
			availability: graphicInputAvailability(declaration, accepted[declaration.key]),
		};
		const pending = !sameGraphicInputValue(workingTrace.value, acceptedTrace.value);

		return {
			declaration,
			binding,
			bound: hasBoundValue
				? {
						value: boundValues[declaration.key]!,
						availability: graphicInputAvailability(declaration, boundValues[declaration.key]),
					}
				: undefined,
			working: workingTrace,
			accepted: acceptedTrace,
			pending,
			// Superseded outranks every other status: the field has just been refreshed
			// out from under the operator, and telling them the value is merely `bound`
			// or `manual` would read as their own edit having been accepted.
			status: supersededInputKeys.includes(declaration.key)
				? 'superseded'
				: !workingTrace.availability.available
						? 'unavailable'
						: pending
							? 'pending'
							: binding
								? 'bound'
								: 'manual',
			blocksTake: declaration.required
				&& !graphicInputAvailability(
					declaration,
					acceptGraphicInputValues(stored, declarations)[declaration.key],
				).available,
		};
	});
}

/** Whether two Graphic Input values are the same value, including media references. */
export function sameGraphicInputValue(left: GraphicInputValue, right: GraphicInputValue): boolean {
	if (left === right)
		return true;
	if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null)
		return left.assetId === right.assetId && left.revisionId === right.revisionId;
	return false;
}

/** Whether this Graphic Input is declared, so an edit can name it. */
export function isDeclaredGraphicInput(
	declarations: readonly GraphicInputDeclaration[],
	key: string,
): boolean {
	return findGraphicInputDeclaration(declarations, key) !== undefined;
}
