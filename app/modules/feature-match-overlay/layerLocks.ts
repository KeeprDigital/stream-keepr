import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import { findGraphicItem } from '~~/shared/modules/graphics';
import { editorSelectionKey } from './editorSelection';
import { layerOrder } from './layerSelection';

/**
 * The Feature Match Overlay editor's Layer Locks (#747): the layers an author has
 * kept from canvas edits, each named by its `editorSelectionKey`.
 *
 * Pure, and editor state only: a lock is remembered per browser per Screen and
 * never stored in the Feature Match Layout. A layer is locked in its own right,
 * or through the Graphic Group it is a child of (E28). A Source Item locks like
 * any Graphic Item. A key naming a layer no longer in the layout is harmless, and
 * kept, so undoing a delete brings the layer back locked.
 */
export type LayerLocks = readonly string[];

const LAYER_KEY = /^(?:item|source):.+$/;

/** The locks a stored value holds: its layer keys, and nothing else. */
export function readLayerLocks(stored: unknown): string[] {
	return Array.isArray(stored)
		? stored.filter((key): key is string => typeof key === 'string' && LAYER_KEY.test(key))
		: [];
}

function lockedInOwnRight(locks: LayerLocks, layer: FeatureMatchLayoutEditorLayer): boolean {
	return locks.includes(editorSelectionKey(layer));
}

/** Whether a Graphic Item is locked only because its Graphic Group is. */
export function isLockedByGroup(layout: FeatureMatchLayoutConfig, locks: LayerLocks, layer: FeatureMatchLayoutEditorLayer): boolean {
	if (layer.type !== 'item' || lockedInOwnRight(locks, layer))
		return false;
	const group = findGraphicItem(layout.composition, layer.itemId)?.group;
	return group !== undefined && lockedInOwnRight(locks, { type: 'item', itemId: group.id });
}

/** Whether the canvas leaves this layer alone: locked in its own right, or through its group. */
export function isLayerLocked(layout: FeatureMatchLayoutConfig, locks: LayerLocks, layer: FeatureMatchLayoutEditorLayer): boolean {
	return lockedInOwnRight(locks, layer) || isLockedByGroup(layout, locks, layer);
}

/**
 * Lock or unlock layers together, as the layer list's toggle does: every one
 * locks while any is unlocked, and all unlock once all are locked. A child stays
 * locked while its group is.
 */
export function toggleLayerLocks(
	layout: FeatureMatchLayoutConfig,
	locks: LayerLocks,
	layers: readonly FeatureMatchLayoutEditorLayer[],
): string[] {
	const lock = layers.some(layer => !isLayerLocked(layout, locks, layer));
	const keys = layers.filter(layer => !lock || !isLayerLocked(layout, locks, layer)).map(editorSelectionKey);
	return lock
		? [
				...locks,
				...keys.filter((key, index) => keys.indexOf(key) === index),
			]
		: locks.filter(key => !keys.includes(key));
}

/** Every locked layer of the layout, in the layer list's order, a locked group's children included. */
export function lockedLayers(layout: FeatureMatchLayoutConfig, locks: LayerLocks): FeatureMatchLayoutEditorLayer[] {
	if (locks.length === 0)
		return [];
	return layerOrder(layout).filter(layer => isLayerLocked(layout, locks, layer));
}
