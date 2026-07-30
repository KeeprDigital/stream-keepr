import { FEATURE_MATCH_TOKEN_CATALOGUE } from '../../featureMatchTokenCatalogue';

/**
 * Host Contract seam.
 *
 * The declaration a graphics Screen Mode supplies when it embeds the shared
 * compositor. It carries only what the compositor reads: which host it is, which
 * data contexts it can supply to a Graphic Item Definition, how many compositions
 * its authoring tree roots, and where a Graphic Text Template's placeholder values
 * come from. Capability outside the contract stays host-owned.
 *
 * Canvas defaults are deliberately absent — they already live on the Screen Mode
 * Definition as its graphics host, and one number wants one home.
 *
 * ## Every field has a consumer, and one deliberately absent field does not
 *
 * This seam was reduced on purpose when Broadcast Graphics was its only host, with
 * the note that Feature Match Overlay "should add each field when it has a real
 * consumer rather than inherit a shape guessed for it". Adopting it, three fields
 * earned their place and one did not:
 *
 * - `contextKinds` gates the definition palette. A Feature Match host supplies the
 *   Feature Match context, which is what makes the Clock, Player Life, and Game
 *   Wins Definitions offerable.
 * - `composition` decides whether the authoring tree roots a stack. A Broadcast
 *   Graphics Screen composes an ordered stack of Broadcast Graphics; a Feature
 *   Match Overlay renders exactly one Feature Match Layout for exactly one Feature
 *   Match Slot, so there is no stack to author, add to, reorder, or delete from.
 * - `textValues` decides where `{placeholder}` values come from, and therefore
 *   whether the inspector offers Graphic Input declarations at all. A Broadcast
 *   Graphic Template declares typed Graphic Inputs with a staged or live On-air
 *   Update Policy; a Feature Match Overlay declares none and binds host tokens
 *   instead. Making it one field rather than two makes the invalid combination
 *   unrepresentable: a host cannot be in host-token mode without a catalogue, and
 *   cannot author Graphic Inputs while in it.
 * - **Instant-apply write semantics is not a field.** It would have no reader.
 *   Both hosts already write through the same instant path — Broadcast Graphics
 *   through `updateGraphics()` in its Settings component and Feature Match Overlay
 *   through `useModeConfigUpdate`'s `updateConfig` — and nothing in the compositor
 *   stages, batches, or defers a write. A flag declaring what is already true by
 *   construction is exactly the unread field this seam was reduced to avoid. What
 *   Broadcast Graphics stages is Graphic Inputs for an Update Graphic acceptance,
 *   which is live state rather than authoring, and `textValues` already says which
 *   host has them.
 *
 * Channels and staged playout need no field for the same reason: they live in the
 * Live workspace, which a Feature Match Overlay never renders. The compositor has
 * never known about them.
 */

export type GraphicsHostId = 'broadcast-graphics' | 'feature-match-overlay';

/** A data context a host can supply to a Graphic Item Definition. */
export type GraphicsContextKind = 'event' | 'feature-match';

/**
 * How many compositions the host's authoring tree roots.
 *
 * `stack` roots an ordered, author-editable stack of Broadcast Graphics. `single`
 * roots exactly one composition the host owns: it is still passed to the
 * compositor as a stack of one, because the render model composes a stack and one
 * is a stack, but nothing offers to add, reorder, or remove a member.
 */
export type GraphicsHostComposition = 'stack' | 'single';

/** One host-supplied placeholder a Graphic Text Template may name. */
export interface GraphicsHostToken {
	/** The stable key a `{token}` placeholder and a Graphic Placeholder Style name. */
	key: string;
	label: string;
}

/**
 * Where a Graphic Text Template's `{placeholder}` values come from.
 *
 * `graphic-inputs` resolves them from the typed Graphic Inputs the composition
 * declares, and the inspector offers those declarations. `host-tokens` resolves
 * them from a fixed catalogue the host supplies and the author cannot change, so
 * the inspector offers the catalogue to reference rather than controls to declare.
 */
export type GraphicsHostTextValues
	= | { kind: 'graphic-inputs' }
		| { kind: 'host-tokens'; catalogue: readonly GraphicsHostToken[] };

export interface GraphicsHostContract {
	hostId: GraphicsHostId;
	contextKinds: readonly GraphicsContextKind[];
	composition: GraphicsHostComposition;
	textValues: GraphicsHostTextValues;
}

export const BROADCAST_GRAPHICS_HOST_CONTRACT: GraphicsHostContract = {
	hostId: 'broadcast-graphics',
	contextKinds: ['event'],
	composition: 'stack',
	textValues: { kind: 'graphic-inputs' },
};

/**
 * A Feature Match Overlay declares the Feature Match context as well as the Event
 * one: the Clock, Player Life, and Game Wins Definitions require it, and its token
 * catalogue reads both a Feature Match Session and current Event Data.
 */
export const FEATURE_MATCH_OVERLAY_HOST_CONTRACT: GraphicsHostContract = {
	hostId: 'feature-match-overlay',
	contextKinds: ['event', 'feature-match'],
	composition: 'single',
	textValues: { kind: 'host-tokens', catalogue: FEATURE_MATCH_TOKEN_CATALOGUE },
};

/** The placeholder keys this host offers, when the host supplies them itself. */
export function graphicsHostTokenCatalogue(
	contract: GraphicsHostContract,
): readonly GraphicsHostToken[] {
	return contract.textValues.kind === 'host-tokens' ? contract.textValues.catalogue : [];
}

/**
 * Whether this host's compositions declare their own typed Graphic Inputs.
 *
 * Derived rather than stored: a host either declares inputs or binds host tokens,
 * and storing both would let a contract say it does neither or both.
 */
export function authorsGraphicInputs(contract: GraphicsHostContract): boolean {
	return contract.textValues.kind === 'graphic-inputs';
}

/** Whether this host's authoring tree roots an author-editable stack. */
export function authorsGraphicStack(contract: GraphicsHostContract): boolean {
	return contract.composition === 'stack';
}
