import type {
	FeatureMatchGraphicGroupChildConfig,
	FeatureMatchGraphicGroupItemConfig,
	FeatureMatchLayoutConfig,
	FeatureMatchMediaGraphicItemConfig,
	FeatureMatchSourceItemConfig,
	FeatureMatchSpecificGraphicItemConfig,
} from '~~/shared/types/screenConfig';

/** Selection target shared by the Feature Match Overlay editor surfaces. */
export type FeatureMatchOverlaySelectionTarget
	=	| { type: 'canvas' }
		| { type: 'layer'; itemId: string }
		| { type: 'graphic-item'; itemId: string; childId: string };

/** A selection target resolved against a Feature Match Layout. */
export type FeatureMatchOverlaySelection
	=	| { kind: 'canvas' }
		| { kind: 'source'; item: FeatureMatchSourceItemConfig }
		| { kind: 'media'; item: FeatureMatchMediaGraphicItemConfig }
		| { kind: 'graphic-item'; item: FeatureMatchSpecificGraphicItemConfig }
		| { kind: 'group'; item: FeatureMatchGraphicGroupItemConfig }
		| { kind: 'child'; group: FeatureMatchGraphicGroupItemConfig; child: FeatureMatchGraphicGroupChildConfig }
		| { kind: 'missing' };

/** Resolve a selection target to the layout entities it points at, or `missing`. */
export function resolveFeatureMatchOverlaySelection(layout: FeatureMatchLayoutConfig, target: FeatureMatchOverlaySelectionTarget): FeatureMatchOverlaySelection {
	if (target.type === 'canvas')
		return { kind: 'canvas' };

	const item = layout.items.find(candidate => candidate.id === target.itemId);
	if (!item)
		return { kind: 'missing' };

	if (target.type === 'graphic-item') {
		if (item.type !== 'graphic-group')
			return { kind: 'missing' };
		const child = item.children.find(candidate => candidate.id === target.childId);
		return child ? { kind: 'child', group: item, child } : { kind: 'missing' };
	}

	switch (item.type) {
		case 'source':
			return { kind: 'source', item };
		case 'media':
			return { kind: 'media', item };
		case 'graphic-item':
			return { kind: 'graphic-item', item };
		case 'graphic-group':
			return { kind: 'group', item };
	}
}

/** Stable identity key for a selection target (tree nodes, comparisons). */
export function featureMatchOverlaySelectionKey(target: FeatureMatchOverlaySelectionTarget): string {
	if (target.type === 'canvas')
		return 'canvas';
	if (target.type === 'graphic-item')
		return `graphicItem:${target.itemId}:${target.childId}`;
	return `layer:${target.itemId}`;
}

/** Runtime guard for selection targets crossing a postMessage boundary. */
export function isFeatureMatchOverlaySelectionTarget(value: unknown): value is FeatureMatchOverlaySelectionTarget {
	if (typeof value !== 'object' || value === null)
		return false;
	const target = value as Record<string, unknown>;
	if (target.type === 'canvas')
		return true;
	if (target.type === 'layer')
		return typeof target.itemId === 'string';
	if (target.type === 'graphic-item')
		return typeof target.itemId === 'string' && typeof target.childId === 'string';
	return false;
}
