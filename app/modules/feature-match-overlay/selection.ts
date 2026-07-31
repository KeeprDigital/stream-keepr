import type { FeatureMatchLayoutConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';

/**
 * The host-owned Feature Match Overlay selection: the canvas — which is the
 * Frame — or one Source Item.
 *
 * It names two things because the host owns two. The shared item tree has its own
 * selection in the shared compositor's vocabulary, held separately by the editor
 * and the preview, because the two surfaces name things in different vocabularies.
 */
export type FeatureMatchOverlaySelectionTarget
	=	| { type: 'canvas' }
		| { type: 'source'; itemId: string };

/** A selection target resolved against a Feature Match Layout. */
export type FeatureMatchOverlaySelection
	=	| { kind: 'canvas' }
		| { kind: 'source'; item: FeatureMatchSourceItemConfig }
		| { kind: 'missing' };

/** Resolve a selection target to the layout entity it points at, or `missing`. */
export function resolveFeatureMatchOverlaySelection(
	layout: FeatureMatchLayoutConfig,
	target: FeatureMatchOverlaySelectionTarget,
): FeatureMatchOverlaySelection {
	if (target.type === 'canvas')
		return { kind: 'canvas' };

	const item = layout.sources.find(candidate => candidate.id === target.itemId);
	return item ? { kind: 'source', item } : { kind: 'missing' };
}

/** Stable identity key for a selection target (tree nodes, comparisons). */
export function featureMatchOverlaySelectionKey(target: FeatureMatchOverlaySelectionTarget): string {
	return target.type === 'canvas' ? 'canvas' : `source:${target.itemId}`;
}

/** Runtime guard for selection targets crossing a postMessage boundary. */
export function isFeatureMatchOverlaySelectionTarget(value: unknown): value is FeatureMatchOverlaySelectionTarget {
	if (typeof value !== 'object' || value === null)
		return false;
	const target = value as Record<string, unknown>;
	if (target.type === 'canvas')
		return true;
	return target.type === 'source' && typeof target.itemId === 'string';
}
