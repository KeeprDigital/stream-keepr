import type { GraphicsEditorLayer, GraphicsEditorTree } from './host';
import { layerConfig, layerItemLocation, patchLayer } from './host';

/**
 * The graphics editor's Layer Locks (#747): the layers an author has kept from
 * canvas edits.
 *
 * Pure. A lock is the layer's own `locked` field in the document (#943,
 * ADR-0063), so it reaches every session and travels with the document; a layer
 * stored without one is unlocked. A layer is locked in its own right, or through
 * the Graphic Group it is a child of (E28). A host's own layer, such as a Source
 * Item, locks like any Graphic Item.
 */

function lockedInOwnRight<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D, layer: L): boolean {
	return layerConfig(tree, document, layer)?.locked === true;
}

/** Whether a Graphic Item is locked only because its Graphic Group is. */
export function isLockedByGroup<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D, layer: L): boolean {
	if (lockedInOwnRight(tree, document, layer))
		return false;
	return layerItemLocation(tree, document, layer)?.group?.locked === true;
}

/** Whether the canvas leaves this layer alone: locked in its own right, or through its group. */
export function isLayerLocked<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D, layer: L): boolean {
	return lockedInOwnRight(tree, document, layer) || isLockedByGroup(tree, document, layer);
}

/**
 * Lock or unlock layers together, as the layer list's toggle does: every one
 * locks while any is unlocked, and all unlock once all are locked. A child stays
 * locked while its group is. Answers the document with each layer's lock written,
 * an unlocked layer stored as one never locked.
 */
export function toggleLayerLocks<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
): D {
	const locked = layers.some(layer => !isLayerLocked(tree, document, layer));
	// Locking writes the unlocked ones; unlocking, those locked in their own right.
	return layers
		.filter(layer => locked
			? !isLayerLocked(tree, document, layer)
			: lockedInOwnRight(tree, document, layer))
		.reduce((next, layer) => patchLayer(tree, next, layer, { locked }), document);
}

/** Every locked layer of the document, in the layer list's order, a locked group's children included. */
export function lockedLayers<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D): L[] {
	return tree.order(document).filter(layer => isLayerLocked(tree, document, layer));
}
