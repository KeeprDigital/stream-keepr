import type { MaybeRefOrGetter } from 'vue';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSlot } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleAuthoringContext } from '~/composables/screen/useGraphicStyleSetAuthoring';
import type { GraphicsSelection, GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { computed, toValue } from 'vue';
import {
	bindGraphicStyleRef,
	recaptureGraphicStyleOverrides,
	unbindGraphicStyleRef,
} from '~~/shared/modules/graphic-style-sets';
import { replaceBroadcastGraphic } from '~~/shared/modules/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';

/**
 * The compositor editing module: one editing chain for a compositor panel's edits to
 * a Broadcast Graphic stack. The item Inspector and the Animation panel edit through
 * it; the stack tree, Graphic Input Bindings, and Social Profile Projections panels
 * still run their own guard until they move to it (#598).
 *
 * 1. The fail-closed Graphics Authoring Lease check.
 * 2. Resolving the selection the edit is aimed at.
 * 3. Applying the authoring operation.
 * 4. Re-capturing Graphic Style Set overrides against the stored graphic (#198).
 * 5. Replacing the stack.
 *
 * A panel hands it an edit and commits whatever stack comes back. It never checks the
 * lease, re-captures, or replaces the stack itself.
 *
 * The lease here is the client half only: it keeps an observer's controls from
 * writing. Admission belongs to the server, which decides and fences every write that
 * edits a Screen's graphics Edit workspace (ADR-0030).
 */

/** What a compositor panel edits against. */
export interface CompositorEditingState {
	/** The stack as stored: what the edit starts from, and what re-capture judges it against. */
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	/**
	 * Whether this Session holds the artifact's Graphics Authoring Lease. Only `true`
	 * grants authoring: an unstated permission is never permission.
	 */
	writable?: boolean;
	/**
	 * The published Graphic Style Set the selection is linked to. Absent means nothing is
	 * re-captured and nothing can be bound: an unlinked composition, or a Style Set that
	 * could not be loaded.
	 */
	styleSet?: GraphicStyleAuthoringContext;
}

/** An authoring operation on one Graphic Item of a Broadcast Graphic. */
export type GraphicItemOperation<A extends unknown[] = []> = (
	graphic: BroadcastGraphicConfig,
	itemId: string,
	...args: A
) => BroadcastGraphicConfig;

/** An authoring operation on one Broadcast Graphic of the stack. */
export type BroadcastGraphicOperation<A extends unknown[] = []> = (
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	...args: A
) => BroadcastGraphicConfig[];

/**
 * One edit a panel hands the module.
 *
 * `author` says what to do for each kind of selection it applies to; a selection it
 * has nothing for refuses the edit. The style-reference edits aim at whichever owner is
 * selected: the Broadcast Graphic itself, or one Graphic Item.
 */
export type CompositorEdit
	= | {
		kind: 'author';
		/** Applied while a Broadcast Graphic is selected. */
		graphic?: BroadcastGraphicOperation;
		/** Applied while a Graphic Item is selected. */
		item?: GraphicItemOperation;
	}
	| { kind: 'bind-style-ref'; slot: GraphicStyleSlot; entryId: string }
	| { kind: 'unbind-style-ref'; slot: GraphicStyleSlot };

/** The one Graphics Authoring Lease guard: fail closed. */
function canAuthorCompositor(state: Pick<CompositorEditingState, 'writable'>): boolean {
	return state.writable === true;
}

/**
 * Run one edit through the editing chain.
 *
 * Answers the next stack, or `null` when the edit is refused: this Session does not
 * hold the lease, the selection is gone or is something the edit has nothing for, or a
 * bind has no Style Set to bind to. The stack it is given is never changed, and every
 * Broadcast Graphic the edit did not touch comes back as the same object.
 */
export function editCompositorStack(
	state: CompositorEditingState,
	edit: CompositorEdit,
): BroadcastGraphicConfig[] | null {
	if (!canAuthorCompositor(state))
		return null;
	const next = applyEdit(state, resolveGraphicsSelection(state.graphics, state.selectedTarget), edit);
	return next && recaptureEditedGraphics(state, next);
}

function applyEdit(
	state: CompositorEditingState,
	selection: GraphicsSelection,
	edit: CompositorEdit,
): BroadcastGraphicConfig[] | null {
	if (selection.kind !== 'graphic' && selection.kind !== 'item')
		return null;
	const ownerId = selection.kind === 'item' ? selection.item.id : null;

	switch (edit.kind) {
		case 'author':
			if (selection.kind === 'graphic')
				return edit.graphic ? edit.graphic(state.graphics, selection.graphic.id) : null;
			return edit.item ? replaceBroadcastGraphic(state.graphics, edit.item(selection.graphic, selection.item.id)) : null;
		case 'bind-style-ref':
			return state.styleSet
				? replaceBroadcastGraphic(
						state.graphics,
						bindGraphicStyleRef(selection.graphic, ownerId, edit.slot, edit.entryId, state.styleSet.resolution),
					)
				: null;
		case 'unbind-style-ref':
			return replaceBroadcastGraphic(state.graphics, unbindGraphicStyleRef(selection.graphic, ownerId, edit.slot));
	}
}

/**
 * Every edited Broadcast Graphic, with its Graphic Style Set overrides brought back
 * into line with what it now holds.
 *
 * This is where a value edit becomes an explicit property-level override. Controls
 * write values and know nothing about provenance; re-deriving the deviations here is
 * what lets every control take part without being taught to, and an author who edits
 * a value and puts it back is left with no override pinning it. With no Style Set
 * loaded it is the identity.
 *
 * Each is judged against the graphic as stored before this edit, which is what says
 * which slots had a pending Style Set change in them: the edited copy cannot, since the
 * edit is itself a difference from the entry (#198). A graphic the edit added has no
 * stored version and nothing to re-capture.
 */
function recaptureEditedGraphics(state: CompositorEditingState, next: BroadcastGraphicConfig[]): BroadcastGraphicConfig[] {
	const context = state.styleSet;
	if (!context)
		return next;
	return next.map((graphic) => {
		const stored = state.graphics.find(candidate => candidate.id === graphic.id);
		return stored && stored !== graphic
			? recaptureGraphicStyleOverrides(graphic, context.resolution, context.publishedRevision, stored)
			: graphic;
	});
}

/**
 * The compositor editing module, bound to one panel.
 *
 * `state` is read afresh for every edit, so an edit always starts from the stack and
 * selection the panel is showing. `commit` receives each admitted edit's next stack; a
 * refused edit commits nothing.
 */
export function useCompositorEditing(
	state: MaybeRefOrGetter<CompositorEditingState>,
	commit: (graphics: BroadcastGraphicConfig[]) => void,
) {
	/** Whether this Session may author: what a panel disables its controls by. */
	const canAuthor = computed(() => canAuthorCompositor(toValue(state)));

	function edit(next: CompositorEdit): void {
		const graphics = editCompositorStack(toValue(state), next);
		if (graphics)
			commit(graphics);
	}

	return {
		canAuthor,
		edit,
		/** Apply one authoring operation to the selected Graphic Item. */
		editItem<A extends unknown[]>(operation: GraphicItemOperation<A>, ...args: A): void {
			edit({ kind: 'author', item: (graphic, itemId) => operation(graphic, itemId, ...args) });
		},
		/** Apply one authoring operation to the selected Broadcast Graphic. */
		editGraphic<A extends unknown[]>(operation: BroadcastGraphicOperation<A>, ...args: A): void {
			edit({ kind: 'author', graphic: (graphics, graphicId) => operation(graphics, graphicId, ...args) });
		},
		/** Reference one Graphic Style Set entry from a slot of the selected owner. */
		bindStyleRef(slot: GraphicStyleSlot, entryId: string): void {
			edit({ kind: 'bind-style-ref', slot, entryId });
		},
		/** Stop inheriting one slot of the selected owner, keeping the value it holds. */
		unbindStyleRef(slot: GraphicStyleSlot): void {
			edit({ kind: 'unbind-style-ref', slot });
		},
	};
}
