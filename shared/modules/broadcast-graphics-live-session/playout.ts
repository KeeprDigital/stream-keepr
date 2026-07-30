import type { GraphicSourceSelectionsState } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicInputBinding,
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicPlayoutState,
	GraphicSourceSelectionDeclaration,
} from '~~/shared/types/graphics';
import type {
	BroadcastGraphicInputsState,
	NormalizedBroadcastGraphicInputsState,
} from './inputs';
import {
	graphicInputAvailability,
	isOperatorSelectedGraphicSource,
} from '~~/shared/modules/graphics';
import {
	acceptGraphicInputValues,
	broadcastGraphicInputsState,
	broadcastGraphicSourceSelections,
	createInitialBroadcastGraphicInputsState,
	effectiveGraphicInputValue,
	isDeclaredGraphicInput,
	unavailableRequiredGraphicInputs,
} from './inputs';
import { BroadcastGraphicsCommandRejection } from './rejection';

/**
 * Broadcast Graphics playout reduction.
 *
 * Shared isomorphic domain logic: the server reduces accepted commands with it
 * and every client derives what is on air from the same functions, so operator
 * UI and Screen Outputs can never disagree about the authoritative order's
 * meaning.
 *
 * ## Target state, not queued events
 *
 * Take and Out express the latest desired on-air state of one Broadcast
 * Graphic. Reducing them is therefore an assignment rather than a transition:
 * repeating either is idempotent by construction, and the last accepted
 * conflicting intent wins because it simply overwrites the previous one. Each
 * command owns exactly one Broadcast Graphic's field, so intents for different
 * graphics never interfere.
 *
 * ## Why recovery cannot replay animation
 *
 * The state below stores the accepted *intent* and nothing else — no lifecycle
 * phase, no phase start time. A Graphic Playout State is derived from that
 * intent on every read, so a reload, disconnect, or server restart can only
 * ever resolve a target-on-air Broadcast Graphic to settled on air at its
 * Graphic Resting State. There is no stored phase for recovery to resume.
 * Graphic Animation adds the entering, updating, and exiting states by deriving
 * them from an authoritative effective start time, which is likewise computed
 * rather than persisted mid-flight.
 *
 * ## Why Event Data reaches reduction as a function
 *
 * Graphic Input Bindings resolve against Event Data, which is neither live state
 * nor something a pure reducer can read. It arrives in the reduction context as a
 * resolver over Graphic Source Selections rather than as a fixed map, because
 * Select Source changes the very selections the bindings resolve against: the
 * command's own effect has to be visible to the resolution its acceptance depends
 * on. Authored declarations arrive the same way, and for the same reason they
 * always have — an author may change them under a running show, so live state must
 * never hold a copy.
 */

/** The latest accepted playout intent for one placed Broadcast Graphic. */
export interface BroadcastGraphicPlayout {
	/** Whether the operator's latest accepted intent puts this graphic on air. */
	onAir: boolean;
}

/**
 * The live state of a Broadcast Graphics Live Session.
 *
 * Keyed by Broadcast Graphic id rather than ordered, because Take timing never
 * affects rendering order: concurrent graphics always composite in the Screen's
 * authored stack order, which lives in Screen configuration.
 */
export interface BroadcastGraphicsLiveState {
	playout: Record<string, BroadcastGraphicPlayout>;
	/** Working, override, and accepted Graphic Input values, per placed Broadcast Graphic. */
	inputs: Record<string, BroadcastGraphicInputsState>;
	/**
	 * Which entity each operator-selected Graphic Source Selection names, per placed
	 * Broadcast Graphic. Only the selection is stored — never the entity, which
	 * follows Event Data.
	 *
	 * Optional for the same reason `overrides` is: a session persisted before Graphic
	 * Source Selections existed carries no such key, and every read normalizes.
	 */
	sources?: Record<string, GraphicSourceSelectionsState>;
}

/** The actions a Broadcast Graphics Live Session accepts. */
export const BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES = [
	'Take',
	'Out',
	'Update Graphic',
	'Set Input',
	'Set Override',
	'Select Source',
	'Resolve Bindings',
] as const;

export type BroadcastGraphicsCommandType = typeof BROADCAST_GRAPHICS_COMMAND_TYPE_VALUES[number];

export interface BroadcastGraphicsPlayoutPayload {
	graphicId: string;
	/**
	 * The Cut execution modifier: reach the action's target without running its
	 * Graphic Animation phase. It never changes the target itself, so while
	 * animation does not exist a Cut action is indistinguishable from its plain
	 * counterpart — it is still accepted in the authoritative order so that
	 * operators, clients, and receipts record the intent they actually issued.
	 */
	cut?: boolean;
}

/**
 * One atomic acceptance of a Broadcast Graphic's staged Graphic Inputs.
 *
 * `basedOnAcceptedRevision` is the sequence guard: the acceptance names the one
 * it supersedes, so an operator whose Live Control has fallen behind another
 * operator's acceptance is refused rather than silently overwriting it. Cut
 * Update is this same intent with the modifier set, never a second intent — which
 * is also why a retry of it keeps its own command id.
 */
export interface BroadcastGraphicsUpdatePayload extends BroadcastGraphicsPlayoutPayload {
	basedOnAcceptedRevision: number;
}

/**
 * One edit to a declared Graphic Input's working value.
 *
 * The value is stored as the operator entered it, even when it violates the
 * declaration: it is reported unavailable rather than coerced, so Live Control can
 * show what was entered and why it cannot go on air. Acceptance is what refuses
 * to put an unavailable value on air, not this write.
 */
export interface BroadcastGraphicsSetInputPayload {
	graphicId: string;
	inputKey: string;
	value: GraphicInputValue;
}

/**
 * One Graphic Input Override set or cleared.
 *
 * `null` clears it. An override exists to mask a binding with an operator's own
 * value, so masking with "no value" would mean nothing — clearing is how an
 * operator stops masking, after which the current bound value resumes.
 */
export interface BroadcastGraphicsSetOverridePayload {
	graphicId: string;
	inputKey: string;
	value: GraphicInputValue;
}

/**
 * One Graphic Source Selection pointed at an entity, or cleared with `null`.
 *
 * Only the entity id is accepted. Storing the entity itself would make live state
 * a stale copy of Event Data, and every binding through this selection re-resolves
 * from current Event Data instead.
 */
export interface BroadcastGraphicsSelectSourcePayload {
	graphicId: string;
	sourceKey: string;
	selectionId: number | null;
}

/**
 * One re-resolution of a Broadcast Graphic's Graphic Input Bindings.
 *
 * Sent when Event Data a binding reads has changed, so a live On-air Update Policy
 * input can reach air without an operator touching anything. It carries no value:
 * the server re-resolves from Event Data itself, so this is a notification that the
 * facts moved rather than a client's claim about what they moved to. Applying it
 * twice accepts the same resolved value twice, which is why redelivery — including
 * from a second Live Control watching the same change — converges.
 */
export interface BroadcastGraphicsResolveBindingsPayload {
	graphicId: string;
}

export type BroadcastGraphicsCommandPayload
	= | BroadcastGraphicsPlayoutPayload
		| BroadcastGraphicsUpdatePayload
		| BroadcastGraphicsSetInputPayload
		| BroadcastGraphicsSetOverridePayload
		| BroadcastGraphicsSelectSourcePayload
		| BroadcastGraphicsResolveBindingsPayload;

/** One command as the reducer reads it: what kind of intent, and its content. */
export type BroadcastGraphicsCommandInput
	= | { type: 'Take' | 'Out'; payload: BroadcastGraphicsPlayoutPayload }
		| { type: 'Update Graphic'; payload: BroadcastGraphicsUpdatePayload }
		| { type: 'Set Input'; payload: BroadcastGraphicsSetInputPayload }
		| { type: 'Set Override'; payload: BroadcastGraphicsSetOverridePayload }
		| { type: 'Select Source'; payload: BroadcastGraphicsSelectSourcePayload }
		| { type: 'Resolve Bindings'; payload: BroadcastGraphicsResolveBindingsPayload };

/**
 * What the reducer needs to know about the Broadcast Graphic a command addresses.
 *
 * Its declared Graphic Inputs, Graphic Source Selections, and Graphic Input
 * Bindings, plus a way to resolve those bindings against current Event Data. None
 * of it belongs in live state: the declarations are authored configuration an
 * author may change under a running show, and Event Data belongs to the Event.
 */
export interface BroadcastGraphicsReductionContext {
	inputs: readonly GraphicInputDeclaration[];
	sources?: readonly GraphicSourceSelectionDeclaration[];
	bindings?: readonly GraphicInputBinding[];
	/**
	 * The latest bound value of each bound Graphic Input, for a given set of Graphic
	 * Source Selections. Absent resolves nothing, which is what a caller with no
	 * Event Data to hand — and every Broadcast Graphic that declares no binding —
	 * correctly means.
	 */
	resolveBindings?: (selections: GraphicSourceSelectionsState) => Record<string, GraphicInputValue>;
}

export function createInitialBroadcastGraphicsLiveState(): BroadcastGraphicsLiveState {
	return { playout: {}, inputs: {}, sources: {} };
}

function withInputs(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	inputs: NormalizedBroadcastGraphicInputsState,
): BroadcastGraphicsLiveState {
	return { ...state, inputs: { ...state.inputs, [graphicId]: inputs } };
}

/** The latest bound values for one Broadcast Graphic's current Graphic Source Selections. */
function boundValuesFor(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
	context: BroadcastGraphicsReductionContext,
	selections: GraphicSourceSelectionsState = broadcastGraphicSourceSelections(state, graphicId),
): Record<string, GraphicInputValue> {
	return context.resolveBindings?.(selections) ?? {};
}

/**
 * Accept one Graphic Input's effective value now, if its On-air Update Policy says
 * so and the graphic is on air.
 *
 * A live acceptance deliberately leaves `acceptedRevision` alone. It accepts its
 * own fields and nothing else, so counting it would make ordinary live edits
 * invalidate a staged Update Graphic another operator is preparing on the same
 * graphic's other inputs.
 */
function acceptLivePolicyValues(
	inputs: NormalizedBroadcastGraphicInputsState,
	context: BroadcastGraphicsReductionContext,
	bound: Readonly<Record<string, GraphicInputValue>>,
	onAir: boolean,
	keys?: readonly string[],
): Record<string, GraphicInputValue> {
	if (!onAir)
		return inputs.accepted;

	let accepted = inputs.accepted;
	for (const declaration of context.inputs) {
		if (declaration.updatePolicy !== 'live')
			continue;
		if (keys && !keys.includes(declaration.key))
			continue;

		const effective = effectiveGraphicInputValue(declaration, inputs, context.bindings, bound);
		if (!graphicInputAvailability(declaration, effective.value).available)
			continue;
		if (accepted === inputs.accepted)
			accepted = { ...inputs.accepted };
		accepted[declaration.key] = effective.value;
	}

	return accepted;
}

/**
 * Take: state that this Broadcast Graphic is the operator's latest desired on-air
 * intent, and accept the values it should enter with.
 *
 * A graphic already on air only has its intent restated. Accepting the working
 * set again would make a second press a backdoor Update Graphic, and partial edits
 * would reach program without anyone confirming them — so Take accepts only on the
 * way on air, which is exactly the rule that editing an off graphic changes the
 * working values its *next* Take accepts.
 */
function reduceTake(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsPlayoutPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const playout = { ...state.playout, [payload.graphicId]: { onAir: true } };
	if (state.playout[payload.graphicId]?.onAir)
		return { ...state, playout };

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const bound = boundValuesFor(state, payload.graphicId, context);
	const blocked = unavailableRequiredGraphicInputs(inputs, context.inputs, context.bindings, bound);
	if (blocked.length > 0) {
		throw new BroadcastGraphicsCommandRejection(
			'required-input-unavailable',
			`${blocked.map(declaration => declaration.label).join(', ')} must have a value before this Broadcast Graphic can go on air`,
			blocked.map(declaration => declaration.key),
		);
	}

	return {
		...withInputs(state, payload.graphicId, {
			...inputs,
			accepted: acceptGraphicInputValues(inputs, context.inputs, context.bindings, bound),
			acceptedRevision: inputs.acceptedRevision + 1,
		}),
		playout,
	};
}

/**
 * Update Graphic: one atomic acceptance of the complete staged set.
 *
 * A required Graphic Input that has become unavailable does not block it. The
 * graphic is already on air, and the settled rule is that its last accepted value
 * stays visible until the operator updates or overrides it — which acceptance
 * achieves by passing over the unavailable value rather than by refusing.
 */
function reduceUpdateGraphic(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsUpdatePayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	if (!state.playout[payload.graphicId]?.onAir) {
		throw new BroadcastGraphicsCommandRejection(
			'update-unavailable',
			'Update Graphic is available only while a Broadcast Graphic is on air',
		);
	}

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	if (payload.basedOnAcceptedRevision !== inputs.acceptedRevision) {
		throw new BroadcastGraphicsCommandRejection(
			'stale-input-acceptance',
			'Another operator has already accepted a newer Graphic Input set for this Broadcast Graphic',
		);
	}

	const bound = boundValuesFor(state, payload.graphicId, context);

	return withInputs(state, payload.graphicId, {
		...inputs,
		accepted: acceptGraphicInputValues(inputs, context.inputs, context.bindings, bound),
		acceptedRevision: inputs.acceptedRevision + 1,
	});
}

/**
 * Set Input: change one working value, and — under a live On-air Update Policy on
 * an on-air graphic — accept that one field with it.
 *
 * An input a Graphic Input Binding resolves takes its value from that binding
 * rather than from here, so this write is accepted but does not reach air while the
 * binding stands. Live Control offers a Graphic Input Override for a bound input
 * instead; this stays permissive because an author may add or remove a binding
 * under a running show, and refusing an operator's keystroke over that race would
 * be worse than storing a value the binding currently masks.
 */
function reduceSetInput(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsSetInputPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	if (!isDeclaredGraphicInput(context.inputs, payload.inputKey)) {
		throw new BroadcastGraphicsCommandRejection(
			'unknown-input',
			`This Broadcast Graphic declares no Graphic Input named ${payload.inputKey}`,
			[payload.inputKey],
		);
	}

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const edited: NormalizedBroadcastGraphicInputsState = {
		...inputs,
		working: { ...inputs.working, [payload.inputKey]: payload.value },
	};

	return withInputs(state, payload.graphicId, {
		...edited,
		accepted: acceptLivePolicyValues(
			edited,
			context,
			boundValuesFor(state, payload.graphicId, context),
			state.playout[payload.graphicId]?.onAir === true,
			[payload.inputKey],
		),
	});
}

/**
 * Set Override: mask this Graphic Input's binding with an operator's value, or clear
 * the mask.
 *
 * The binding keeps resolving underneath, which is the whole point: an operator
 * correcting one wrong value does not lose the live feed, and clearing the override
 * resumes whatever the binding resolves at that moment rather than whatever it
 * resolved when the override was set.
 */
function reduceSetOverride(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsSetOverridePayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	if (!isDeclaredGraphicInput(context.inputs, payload.inputKey)) {
		throw new BroadcastGraphicsCommandRejection(
			'unknown-input',
			`This Broadcast Graphic declares no Graphic Input named ${payload.inputKey}`,
			[payload.inputKey],
		);
	}

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const overrides = { ...inputs.overrides };
	if (payload.value === null)
		delete overrides[payload.inputKey];
	else
		overrides[payload.inputKey] = payload.value;

	const edited: NormalizedBroadcastGraphicInputsState = { ...inputs, overrides };

	return withInputs(state, payload.graphicId, {
		...edited,
		accepted: acceptLivePolicyValues(
			edited,
			context,
			boundValuesFor(state, payload.graphicId, context),
			state.playout[payload.graphicId]?.onAir === true,
			[payload.inputKey],
		),
	});
}

/**
 * Select Source: point one Graphic Source Selection at an entity, or clear it.
 *
 * Every Graphic Input Binding reading that selection re-resolves, and the On-air
 * Update Policy decides which of those resolved values reach air now: a live one
 * applies immediately, a staged one waits for Update Graphic. That is why the new
 * selection is resolved here rather than after the command — the acceptance this
 * command performs depends on its own effect.
 */
function reduceSelectSource(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsSelectSourcePayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const declaration = context.sources?.find(source => source.key === payload.sourceKey);
	if (!declaration || !isOperatorSelectedGraphicSource(declaration)) {
		throw new BroadcastGraphicsCommandRejection(
			'unknown-source',
			`This Broadcast Graphic has no operator-selected Graphic Source Selection named ${payload.sourceKey}`,
		);
	}

	const selections = { ...broadcastGraphicSourceSelections(state, payload.graphicId) };
	if (payload.selectionId === null)
		delete selections[payload.sourceKey];
	else
		selections[payload.sourceKey] = payload.selectionId;

	const inputs = broadcastGraphicInputsState(state, payload.graphicId);
	const bound = boundValuesFor(state, payload.graphicId, context, selections);

	return {
		...state,
		sources: { ...state.sources, [payload.graphicId]: selections },
		inputs: {
			...state.inputs,
			[payload.graphicId]: {
				...inputs,
				accepted: acceptLivePolicyValues(
					inputs,
					context,
					bound,
					state.playout[payload.graphicId]?.onAir === true,
				),
			},
		},
	};
}

/**
 * Resolve Bindings: re-resolve this Broadcast Graphic's bindings and let the On-air
 * Update Policy decide what that means.
 *
 * A live-policy input reaches air immediately; a staged one is left pending for an
 * Update Graphic, which is the same rule every other acceptance follows. The command
 * exists because Event Data changes without anybody issuing an operator action, and
 * a lower third bound to a Player who has just been renamed should say the new name.
 */
function reduceResolveBindings(
	state: BroadcastGraphicsLiveState,
	payload: BroadcastGraphicsResolveBindingsPayload,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const inputs = broadcastGraphicInputsState(state, payload.graphicId);

	return withInputs(state, payload.graphicId, {
		...inputs,
		accepted: acceptLivePolicyValues(
			inputs,
			context,
			boundValuesFor(state, payload.graphicId, context),
			state.playout[payload.graphicId]?.onAir === true,
		),
	});
}

/**
 * Reduce one accepted command onto the Live Session's state.
 *
 * Playout intents are assignments, which is what makes them idempotent by
 * construction. Graphic Input acceptance is not: accepting a staged set twice is a
 * genuine double-apply, so the Command Receipt that recognises a repeated delivery
 * and the acceptance revision that refuses a stale one are both load-bearing here
 * in a way they never were for Take and Out alone.
 */
export function applyBroadcastGraphicsCommand(
	state: BroadcastGraphicsLiveState,
	command: BroadcastGraphicsCommandInput,
	context: BroadcastGraphicsReductionContext,
): BroadcastGraphicsLiveState {
	const normalized: BroadcastGraphicsLiveState = {
		playout: state.playout ?? {},
		inputs: state.inputs ?? {},
		sources: state.sources ?? {},
	};

	switch (command.type) {
		case 'Take':
			return reduceTake(normalized, command.payload, context);
		case 'Out':
			return {
				...normalized,
				playout: { ...normalized.playout, [command.payload.graphicId]: { onAir: false } },
			};
		case 'Update Graphic':
			return reduceUpdateGraphic(normalized, command.payload, context);
		case 'Set Input':
			return reduceSetInput(normalized, command.payload, context);
		case 'Set Override':
			return reduceSetOverride(normalized, command.payload, context);
		case 'Select Source':
			return reduceSelectSource(normalized, command.payload, context);
		case 'Resolve Bindings':
			return reduceResolveBindings(normalized, command.payload, context);
	}
}

/** The Graphic Input state a fresh placed Broadcast Graphic starts from. */
export { createInitialBroadcastGraphicInputsState };

/**
 * The operator-visible lifecycle status of one placed Broadcast Graphic.
 *
 * Only off and on-air are reachable until Graphic Animation exists; waiting,
 * entering, updating, and exiting arrive with the animation and Graphic Channel
 * vocabulary that produces them.
 */
export function broadcastGraphicPlayoutState(
	state: BroadcastGraphicsLiveState,
	graphicId: string,
): GraphicPlayoutState {
	return state.playout[graphicId]?.onAir ? 'on-air' : 'off';
}

/**
 * Which of the Screen's authored Broadcast Graphics compose into the frame,
 * back to front.
 *
 * Derived from the authored stack rather than from the live state's own key
 * order, so Take timing cannot reorder the composition and live state left
 * behind by a since-deleted Broadcast Graphic cannot render.
 */
export function onAirBroadcastGraphicIds(
	state: BroadcastGraphicsLiveState,
	graphics: readonly Pick<BroadcastGraphicConfig, 'id'>[],
): string[] {
	return graphics
		.filter(graphic => broadcastGraphicPlayoutState(state, graphic.id) === 'on-air')
		.map(graphic => graphic.id);
}
