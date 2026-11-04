import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import { findGraphicItem, replaceGraphicItemById, withoutLayerLock } from '~~/shared/modules/graphics';
import { layerOrder } from './layerSelection';

/**
 * The Feature Match Overlay editor's Layer Locks (#747): the layers an author has
 * kept from canvas edits.
 *
 * Pure. A lock is the layer's own `locked` field in the Feature Match Layout
 * (#943, ADR-0063), so it reaches every session and travels with the layout; a
 * layer stored without one is unlocked. A layer is locked in its own right, or
 * through the Graphic Group it is a child of (E28). A Source Item locks like any
 * Graphic Item.
 */

function lockedInOwnRight(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer): boolean {
	return layer.type === 'source'
		? layout.sources.find(source => source.id === layer.itemId)?.locked === true
		: findGraphicItem(layout.composition, layer.itemId)?.item.locked === true;
}

/** Whether a Graphic Item is locked only because its Graphic Group is. */
export function isLockedByGroup(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer): boolean {
	if (layer.type !== 'item' || lockedInOwnRight(layout, layer))
		return false;
	return findGraphicItem(layout.composition, layer.itemId)?.group?.locked === true;
}

/** Whether the canvas leaves this layer alone: locked in its own right, or through its group. */
export function isLayerLocked(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer): boolean {
	return lockedInOwnRight(layout, layer) || isLockedByGroup(layout, layer);
}

/** A layer's own lock set, or its field dropped, so an unlocked layer is stored as one never locked. */
function withLock<T extends { locked?: boolean }>(item: T, locked: boolean): T {
	return locked
		? { ...item, locked: true }
		: withoutLayerLock(item);
}

/**
 * Lock or unlock layers together, as the layer list's toggle does: every one
 * locks while any is unlocked, and all unlock once all are locked. A child stays
 * locked while its group is. Answers the layout with each layer's lock written.
 */
export function toggleLayerLocks(
	layout: FeatureMatchLayoutConfig,
	layers: readonly FeatureMatchLayoutEditorLayer[],
): FeatureMatchLayoutConfig {
	const lock = layers.some(layer => !isLayerLocked(layout, layer));
	// Locking writes the unlocked ones; unlocking, those locked in their own right.
	return layers
		.filter(layer => lock
			? !isLayerLocked(layout, layer)
			: lockedInOwnRight(layout, layer))
		.reduce((next, layer) => {
			if (layer.type === 'source') {
				return {
					...next,
					sources: next.sources.map(source => source.id === layer.itemId
						? withLock(source, lock)
						: source),
				};
			}
			const item = findGraphicItem(next.composition, layer.itemId)?.item;
			return item
				? {
						...next,
						composition: replaceGraphicItemById(next.composition, withLock(item, lock)),
					}
				: next;
		}, layout);
}

/** Every locked layer of the layout, in the layer list's order, a locked group's children included. */
export function lockedLayers(layout: FeatureMatchLayoutConfig): FeatureMatchLayoutEditorLayer[] {
	return layerOrder(layout).filter(layer => isLayerLocked(layout, layer));
}
