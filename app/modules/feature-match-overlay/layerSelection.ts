import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import { findGraphicItem } from '~~/shared/modules/graphics';
import { editorSelectionExists, editorSelectionKey } from './editorSelection';

/**
 * The Feature Match Overlay editor's selection of layers: none (the canvas), one,
 * or several (#740).
 *
 * Pure. Source Items and Graphic Items may be selected together. A Graphic Group
 * is never selected with its own child, nor children of two groups: adding a
 * layer that would break either replaces the selection with it, so the selection
 * always names layers that move together without moving one twice. A verb acting
 * on the selection, such as align or group, reads `layers` and decides for itself
 * which of them it takes.
 */
export interface LayerSelection {
	/** The selected layers, in the order they were added. */
	readonly layers: readonly FeatureMatchLayoutEditorLayer[];
	/**
	 * The layer the author last chose: where a range starts, what Escape keeps,
	 * and which row the layer list keeps in view. One of `layers`, or null with none.
	 */
	readonly anchor: FeatureMatchLayoutEditorLayer | null;
}

export const NO_LAYERS: LayerSelection = { layers: [], anchor: null };

/** Every layer, in the layer list's order: Graphic Items front to back, each group's children beneath it, then Source Items front to back. */
export function layerOrder(layout: FeatureMatchLayoutConfig): FeatureMatchLayoutEditorLayer[] {
	const items = [...layout.composition.items].reverse().flatMap(item => [
		{ type: 'item' as const, itemId: item.id },
		...(item.type === 'group'
			? [...item.children].reverse().map(child => ({ type: 'item' as const, itemId: child.id }))
			: []),
	]);
	const sources = [...layout.sources].reverse().map(source => ({ type: 'source' as const, itemId: source.id }));
	return [
		...items,
		...sources,
	];
}

export function onlyLayer(layer: FeatureMatchLayoutEditorLayer): LayerSelection {
	return {
		layers: [layer],
		anchor: layer,
	};
}

export function isLayerSelected(layers: readonly FeatureMatchLayoutEditorLayer[], layer: FeatureMatchLayoutEditorLayer): boolean {
	const key = editorSelectionKey(layer);
	return layers.some(entry => editorSelectionKey(entry) === key);
}

/** The Graphic Group a Graphic Item is a child of, by id. */
function parentGroupId(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer): string | undefined {
	return layer.type === 'item'
		? findGraphicItem(layout.composition, layer.itemId)?.group?.id
		: undefined;
}

/** Whether two layers cannot be selected together: a group with its own child, or children of two groups. */
function conflicts(layout: FeatureMatchLayoutConfig, a: FeatureMatchLayoutEditorLayer, b: FeatureMatchLayoutEditorLayer): boolean {
	const groupOfA = parentGroupId(layout, a);
	const groupOfB = parentGroupId(layout, b);
	if (groupOfA !== undefined && groupOfB !== undefined)
		return groupOfA !== groupOfB;
	return (groupOfA !== undefined && b.type === 'item' && groupOfA === b.itemId)
		|| (groupOfB !== undefined && a.type === 'item' && groupOfB === a.itemId);
}

/** ⌘-click: add a layer, replacing a selection it cannot join, or take a selected one out. */
export function toggleLayer(layout: FeatureMatchLayoutConfig, selection: LayerSelection, layer: FeatureMatchLayoutEditorLayer): LayerSelection {
	if (isLayerSelected(selection.layers, layer)) {
		const key = editorSelectionKey(layer);
		const layers = selection.layers.filter(entry => editorSelectionKey(entry) !== key);
		return { layers, anchor: layers.at(-1) ?? null };
	}
	if (selection.layers.some(entry => conflicts(layout, entry, layer)))
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
export function extendLayerSelection(layout: FeatureMatchLayoutConfig, selection: LayerSelection, layer: FeatureMatchLayoutEditorLayer): LayerSelection {
	const order = layerOrder(layout);
	const keys = order.map(editorSelectionKey);
	const from = selection.anchor
		? keys.indexOf(editorSelectionKey(selection.anchor))
		: -1;
	const to = keys.indexOf(editorSelectionKey(layer));
	if (from < 0 || to < 0)
		return onlyLayer(layer);
	const run = from <= to
		? order.slice(from, to + 1)
		: order.slice(to, from + 1).reverse();
	const inRun = new Set(run.map(editorSelectionKey));
	const layers = run.filter((entry) => {
		const group = parentGroupId(layout, entry);
		return group === undefined || !inRun.has(editorSelectionKey({ type: 'item', itemId: group }));
	});
	const anchor = isLayerSelected(layers, selection.anchor!)
		? selection.anchor
		: layers[0] ?? null;
	return { layers, anchor };
}

/** Escape: several layers collapse to the anchor, and one to none. */
export function collapseLayerSelection(selection: LayerSelection): LayerSelection {
	return selection.layers.length > 1 && selection.anchor
		? onlyLayer(selection.anchor)
		: NO_LAYERS;
}

/** Drop the layers no longer in the layout, whoever removed them. Answers the same selection when none went. */
export function pruneLayerSelection(layout: FeatureMatchLayoutConfig, selection: LayerSelection): LayerSelection {
	const layers = selection.layers.filter(layer => editorSelectionExists(layout, layer));
	if (layers.length === selection.layers.length)
		return selection;
	const anchor = selection.anchor && isLayerSelected(layers, selection.anchor)
		? selection.anchor
		: layers.at(-1) ?? null;
	return { layers, anchor };
}
