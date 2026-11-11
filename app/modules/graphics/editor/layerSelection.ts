import type { GraphicsEditorLayer, GraphicsEditorTree } from './host';
import { isSameLayer, layerConfig, layerParentGroup } from './host';

/**
 * The graphics editor's selection of layers: none (the canvas), one, or several
 * (#740).
 *
 * Pure. Graphic Items and a host's own layers may be selected together. A Graphic
 * Group is never selected with its own child, nor children of two groups: adding a
 * layer that would break either replaces the selection with it, so the selection
 * always names layers that move together without moving one twice. A verb acting
 * on the selection, such as align or group, reads `layers` and decides for itself
 * which of them it takes.
 */
export interface LayerSelection<L extends GraphicsEditorLayer> {
	/** The selected layers, in the order they were added. */
	readonly layers: readonly L[];
	/**
	 * The layer the author last chose: where a range starts, what Escape keeps,
	 * and which row the layer list keeps in view. One of `layers`, or null with none.
	 */
	readonly anchor: L | null;
}

export const NO_LAYERS: LayerSelection<never> = { layers: [], anchor: null };

export function onlyLayer<L extends GraphicsEditorLayer>(layer: L): LayerSelection<L> {
	return {
		layers: [layer],
		anchor: layer,
	};
}

export function isLayerSelected<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, layers: readonly L[], layer: L): boolean {
	return layers.some(entry => isSameLayer(tree, entry, layer));
}

/** Whether two layers cannot be selected together: a group with its own child, or children of two groups. */
function conflicts<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D, a: L, b: L): boolean {
	const groupOfA = layerParentGroup(tree, document, a);
	const groupOfB = layerParentGroup(tree, document, b);
	if (groupOfA && groupOfB)
		return !isSameLayer(tree, groupOfA, groupOfB);
	return (groupOfA !== undefined && isSameLayer(tree, groupOfA, b))
		|| (groupOfB !== undefined && isSameLayer(tree, groupOfB, a));
}

/** ⌘-click: add a layer, replacing a selection it cannot join, or take a selected one out. */
export function toggleLayer<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	selection: LayerSelection<L>,
	layer: L,
): LayerSelection<L> {
	if (isLayerSelected(tree, selection.layers, layer)) {
		const layers = selection.layers.filter(entry => !isSameLayer(tree, entry, layer));
		return { layers, anchor: layers.at(-1) ?? null };
	}
	if (selection.layers.some(entry => conflicts(tree, document, entry, layer)))
		return onlyLayer(layer);
	return {
		layers: [...selection.layers, layer],
		anchor: layer,
	};
}

/**
 * Shift-click: the layers from the anchor to the one clicked, in the layer list's
 * order, replacing the rest. A group in the range stands for its children, so a
 * range across groups keeps each group whole. Only the children of a group the
 * range starts or ends inside are left, and they all share that group.
 */
export function extendLayerSelection<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	selection: LayerSelection<L>,
	layer: L,
): LayerSelection<L> {
	const order = tree.order(document);
	const keys = order.map(entry => tree.key(entry));
	const from = selection.anchor
		? keys.indexOf(tree.key(selection.anchor))
		: -1;
	const to = keys.indexOf(tree.key(layer));
	if (from < 0 || to < 0)
		return onlyLayer(layer);
	const run = from <= to
		? order.slice(from, to + 1)
		: order.slice(to, from + 1).reverse();
	const inRun = new Set(run.map(entry => tree.key(entry)));
	const layers = run.filter((entry) => {
		const group = layerParentGroup(tree, document, entry);
		return group === undefined || !inRun.has(tree.key(group));
	});
	const anchor = isLayerSelected(tree, layers, selection.anchor!)
		? selection.anchor
		: layers[0] ?? null;
	return { layers, anchor };
}

/** Escape: several layers collapse to the anchor, and one to none. */
export function collapseLayerSelection<L extends GraphicsEditorLayer>(selection: LayerSelection<L>): LayerSelection<L> {
	return selection.layers.length > 1 && selection.anchor
		? onlyLayer(selection.anchor)
		: NO_LAYERS;
}

/** Drop the layers no longer in the document, whoever removed them. Answers the same selection when none went. */
export function pruneLayerSelection<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	selection: LayerSelection<L>,
): LayerSelection<L> {
	const layers = selection.layers.filter(layer => layerConfig(tree, document, layer) !== undefined);
	if (layers.length === selection.layers.length)
		return selection;
	const anchor = selection.anchor && isLayerSelected(tree, layers, selection.anchor)
		? selection.anchor
		: layers.at(-1) ?? null;
	return { layers, anchor };
}
