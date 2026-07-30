import type {
	GraphicInputBinding,
	GraphicInputDeclaration,
	GraphicInputValue,
} from '../../types/graphics';
import type {
	GraphicInputAvailability,
	GraphicSourceSelectionsState,
} from '../graphics';
import {
	findGraphicInputDeclaration,
	graphicInputAvailability,
} from '../graphics';

/**
 * The Graphic Input half of a Broadcast Graphics Live Session's state.
 *
 * ## Four values, not one
 *
 * A live operator has to be able to tell apart what a binding currently resolves,
 * what they have masked it with, what they have edited, and what program is
 * actually showing. Those are distinct things and this module keeps them distinct:
 *
 * - the **latest bound value** is resolved from a Graphic Input Binding and is
 *   never stored here, because it follows Event Data rather than the Live
 *   Session;
 * - a **Graphic Input Override** is an operator value masking that binding. It
 *   lives in the Live Session because it persists across hide/show cycles until
 *   cleared, and the binding keeps resolving underneath it;
 * - the **working value** is the server-accepted manual edit. It lives in the Live
 *   Session, so a second operator's Live Control sees it the moment it is
 *   accepted rather than when its author chooses to publish it;
 * - the **accepted on-air value** is what an on-air Broadcast Graphic renders.
 *   It changes only through an acceptance — Take for an off graphic, Update
 *   Graphic for an on-air one, or a live On-air Update Policy edit — so a partial
 *   edit can never leak on air.
 *
 * ## One effective value, and where it comes from
 *
 * Exactly one of those feeds acceptance, and the precedence is fixed: an override
 * masks everything; failing that a declared Graphic Input Binding decides, whether
 * or not it currently resolves; failing that the manual working value, which
 * starts at the declared default.
 *
 * The middle clause is the load-bearing one. A binding that resolves nothing makes
 * its Graphic Input unavailable and *does not* fall back to the manual value or the
 * template default. Falling back would put an authored placeholder on air wearing
 * the appearance of live data, which is the one failure the settled rule names
 * explicitly. Correcting an unavailable binding is what an override is for.
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
	/** Server-accepted manual edits, shared between sessions immediately. */
	working: Record<string, GraphicInputValue>;
	/**
	 * Graphic Input Overrides, masking their bindings until cleared.
	 *
	 * Optional because this state is a persisted JSON projection that a session
	 * written before overrides existed does not carry. Every read goes through
	 * `broadcastGraphicInputsState`, which fills it in, and every reduction writes it.
	 */
	overrides?: Record<string, GraphicInputValue>;
	/** What an on-air Broadcast Graphic renders. */
	accepted: Record<string, GraphicInputValue>;
	/** How many times the staged set has been accepted, for the sequence guard. */
	acceptedRevision: number;
}

/** The same state with every optional projection field filled in. */
export type NormalizedBroadcastGraphicInputsState
	= Required<BroadcastGraphicInputsState>;

export function createInitialBroadcastGraphicInputsState(): NormalizedBroadcastGraphicInputsState {
	return { working: {}, overrides: {}, accepted: {}, acceptedRevision: 0 };
}

/** One Graphic Input's value with the judgement of whether it can be shown. */
export interface GraphicInputValueTrace {
	value: GraphicInputValue;
	availability: GraphicInputAvailability;
}

/** Which of a Graphic Input's values acceptance would actually use. */
export const GRAPHIC_INPUT_VALUE_SOURCE_VALUES = ['override', 'bound', 'manual', 'none'] as const;

export type GraphicInputValueSource = typeof GRAPHIC_INPUT_VALUE_SOURCE_VALUES[number];

/**
 * What Live Control shows about one Graphic Input's value.
 *
 * The settled vocabulary is bound, overridden, pending, unavailable, and stale, and
 * every one of them is now reachable:
 *
 * - `manual` — no binding, showing what an operator typed or the declared default;
 * - `bound` — a Graphic Input Binding is resolving it and program agrees;
 * - `overridden` — a Graphic Input Override is masking a binding that keeps
 *   resolving underneath it;
 * - `pending` — the value that would go on air differs from the one that is;
 * - `unavailable` — nothing that could go on air: an unresolved binding, or a value
 *   violating its declared type or constraints;
 * - `stale` — on air, and holding a last accepted value that its Graphic Input
 *   Binding no longer provides. Distinct from `unavailable` because program is *not*
 *   empty: the rule is that the last accepted rendering stays until the operator
 *   updates or overrides it, and an operator needs to know they are looking at it.
 *
 * `stale` is reported for any bound input in that position rather than only a
 * required one. Requiredness decides what blocks a Take; it does not change whether
 * what program is showing has outlived its source. What it does need is a binding:
 * an operator's own unusable edit, or an unusable override, is not a source that
 * moved on — it is a value to fix, and calling it stale would point at the wrong
 * cause.
 */
export const GRAPHIC_INPUT_STATUS_VALUES = [
	'manual',
	'bound',
	'overridden',
	'pending',
	'unavailable',
	'stale',
] as const;

export type GraphicInputStatus = typeof GRAPHIC_INPUT_STATUS_VALUES[number];

/** What Live Control generates one field from. */
export interface GraphicInputTrace {
	declaration: GraphicInputDeclaration;
	/**
	 * The latest value this input's Graphic Input Binding resolves, when it has one
	 * and it currently resolves. Absent for an unresolved binding — which never falls
	 * back to the template default.
	 */
	bound?: GraphicInputValueTrace;
	binding?: GraphicInputBinding;
	/** The Graphic Input Override masking this input's binding, while it has one. */
	override?: GraphicInputValueTrace;
	/** The stored manual value, which starts at the declared default. */
	working: GraphicInputValueTrace;
	/** What an acceptance would put on air now, and where it came from. */
	effective: GraphicInputValueTrace & { source: GraphicInputValueSource };
	accepted: GraphicInputValueTrace;
	/** The effective value differs from what is accepted on air. */
	pending: boolean;
	status: GraphicInputStatus;
	/** This required Graphic Input has no value that could go on air. */
	blocksTake: boolean;
}

/** The Graphic Input state of one placed Broadcast Graphic, empty until it has one. */
export function broadcastGraphicInputsState(
	state: { inputs?: Record<string, BroadcastGraphicInputsState> },
	graphicId: string,
): NormalizedBroadcastGraphicInputsState {
	const stored = state.inputs?.[graphicId];
	if (!stored)
		return createInitialBroadcastGraphicInputsState();

	return {
		working: stored.working ?? {},
		overrides: stored.overrides ?? {},
		accepted: stored.accepted ?? {},
		acceptedRevision: stored.acceptedRevision ?? 0,
	};
}

/** The Graphic Source Selections one placed Broadcast Graphic's operator has made. */
export function broadcastGraphicSourceSelections(
	state: { sources?: Record<string, GraphicSourceSelectionsState> },
	graphicId: string,
): GraphicSourceSelectionsState {
	return state.sources?.[graphicId] ?? {};
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
 * The values Live Control edits manually. An input nobody has edited resolves to
 * its declared default, which is what copying a Broadcast Graphic Template onto a
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

function hasBindingFor(
	bindings: readonly GraphicInputBinding[] | undefined,
	key: string,
): boolean {
	return bindings?.some(binding => binding.inputKey === key) ?? false;
}

/**
 * Which value an acceptance would use for one Graphic Input, and where it came from.
 *
 * `none` is a real answer, not a missing one: a declared binding that resolves
 * nothing leaves the input with no value, and reporting that honestly is what stops
 * the template default from standing in for live data.
 */
export function effectiveGraphicInputValue(
	declaration: GraphicInputDeclaration,
	inputs: NormalizedBroadcastGraphicInputsState,
	bindings: readonly GraphicInputBinding[] | undefined,
	bound: Readonly<Record<string, GraphicInputValue>> = {},
): { value: GraphicInputValue; source: GraphicInputValueSource } {
	if (declaration.key in inputs.overrides)
		return { value: inputs.overrides[declaration.key]!, source: 'override' };

	if (hasBindingFor(bindings, declaration.key)) {
		return declaration.key in bound
			? { value: bound[declaration.key]!, source: 'bound' }
			: { value: null, source: 'none' };
	}

	return {
		value: declaration.key in inputs.working ? inputs.working[declaration.key]! : declaration.default,
		source: 'manual',
	};
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
	inputs: NormalizedBroadcastGraphicInputsState,
	declarations: readonly GraphicInputDeclaration[],
	bindings: readonly GraphicInputBinding[] | undefined = undefined,
	bound: Readonly<Record<string, GraphicInputValue>> = {},
): Record<string, GraphicInputValue> {
	const accepted: Record<string, GraphicInputValue> = {};

	for (const declaration of declarations) {
		const effective = effectiveGraphicInputValue(declaration, inputs, bindings, bound);

		if (graphicInputAvailability(declaration, effective.value).available) {
			accepted[declaration.key] = effective.value;
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
 * against the staged set alone: a required input whose new edit is unavailable
 * but whose accepted value still is available is not missing from program.
 */
export function unavailableRequiredGraphicInputs(
	inputs: NormalizedBroadcastGraphicInputsState,
	declarations: readonly GraphicInputDeclaration[],
	bindings: readonly GraphicInputBinding[] | undefined = undefined,
	bound: Readonly<Record<string, GraphicInputValue>> = {},
): GraphicInputDeclaration[] {
	const accepted = acceptGraphicInputValues(inputs, declarations, bindings, bound);
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
	/** The latest values this graphic's Graphic Input Bindings resolve. */
	boundValues: Readonly<Record<string, GraphicInputValue>> = {},
	/** Whether this Broadcast Graphic is on a program output, which is what makes a held value stale. */
	options: { onAir?: boolean } = {},
): GraphicInputTrace[] {
	const declarations = graphic.inputs ?? [];
	const stored = broadcastGraphicInputsState(state, graphicId);
	const working = resolveValues(stored.working, declarations);
	const accepted = resolveValues(stored.accepted, declarations);
	const acceptance = acceptGraphicInputValues(stored, declarations, graphic.bindings, boundValues);

	return declarations.map((declaration) => {
		const key = declaration.key;
		const binding = graphic.bindings?.find(entry => entry.inputKey === key);
		const effective = effectiveGraphicInputValue(declaration, stored, graphic.bindings, boundValues);
		const effectiveTrace = {
			value: effective.value,
			source: effective.source,
			availability: graphicInputAvailability(declaration, effective.value),
		};
		const acceptedTrace: GraphicInputValueTrace = {
			value: accepted[key]!,
			availability: graphicInputAvailability(declaration, accepted[key]),
		};
		const pending = !sameGraphicInputValue(effectiveTrace.value, acceptedTrace.value);
		// On air, holding a last accepted value that this input's *source* no longer
		// provides: program keeps the last accepted rendering, and the operator is told
		// it has outlived its source. An operator's own unusable edit is not stale, it
		// is simply unavailable — which is why this needs a binding, and why an
		// unusable override does not qualify.
		const stale = (options.onAir ?? false)
			&& binding !== undefined
			&& effective.source !== 'override'
			&& !effectiveTrace.availability.available
			&& acceptedTrace.availability.available;

		return {
			declaration,
			binding,
			bound: key in boundValues
				? {
						value: boundValues[key]!,
						availability: graphicInputAvailability(declaration, boundValues[key]),
					}
				: undefined,
			override: key in stored.overrides
				? {
						value: stored.overrides[key]!,
						availability: graphicInputAvailability(declaration, stored.overrides[key]),
					}
				: undefined,
			working: {
				value: working[key]!,
				availability: graphicInputAvailability(declaration, working[key]),
			},
			effective: effectiveTrace,
			accepted: acceptedTrace,
			pending,
			status: stale
				? 'stale'
				: !effectiveTrace.availability.available
						? 'unavailable'
						: effective.source === 'override' && binding
							? 'overridden'
							: pending
								? 'pending'
								: binding
									? 'bound'
									: 'manual',
			blocksTake: declaration.required
				&& !graphicInputAvailability(declaration, acceptance[key]).available,
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
