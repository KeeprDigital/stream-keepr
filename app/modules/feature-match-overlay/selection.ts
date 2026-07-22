import type {
	FeatureMatchLayoutConfig,
	FeatureMatchSourceItemConfig,
	FeatureMatchWidgetGroupChildConfig,
	FeatureMatchWidgetGroupItemConfig,
	FeatureMatchWidgetItemConfig,
} from '~~/shared/types/screenConfig';

/** Selection target shared by the Feature Match Overlay editor surfaces. */
export type FeatureMatchOverlaySelectionTarget
	=	| { type: 'canvas' }
		| { type: 'layer'; itemId: string }
		| { type: 'widget'; itemId: string; childId: string };

/** A selection target resolved against a Feature Match Layout. */
export type FeatureMatchOverlaySelection
	=	| { kind: 'canvas' }
		| { kind: 'source'; item: FeatureMatchSourceItemConfig }
		| { kind: 'widget'; item: FeatureMatchWidgetItemConfig }
		| { kind: 'group'; item: FeatureMatchWidgetGroupItemConfig }
		| { kind: 'child'; group: FeatureMatchWidgetGroupItemConfig; child: FeatureMatchWidgetGroupChildConfig }
		| { kind: 'missing' };

/** Resolve a selection target to the layout entities it points at, or `missing`. */
export function resolveFeatureMatchOverlaySelection(layout: FeatureMatchLayoutConfig, target: FeatureMatchOverlaySelectionTarget): FeatureMatchOverlaySelection {
	if (target.type === 'canvas')
		return { kind: 'canvas' };

	const item = layout.items.find(candidate => candidate.id === target.itemId);
	if (!item)
		return { kind: 'missing' };

	if (target.type === 'widget') {
		if (item.type !== 'widget-group')
			return { kind: 'missing' };
		const child = item.children.find(candidate => candidate.id === target.childId);
		return child ? { kind: 'child', group: item, child } : { kind: 'missing' };
	}

	switch (item.type) {
		case 'source':
			return { kind: 'source', item };
		case 'widget':
			return { kind: 'widget', item };
		case 'widget-group':
			return { kind: 'group', item };
	}
}

/** Stable identity key for a selection target (tree nodes, comparisons). */
export function featureMatchOverlaySelectionKey(target: FeatureMatchOverlaySelectionTarget): string {
	if (target.type === 'canvas')
		return 'canvas';
	if (target.type === 'widget')
		return `widget:${target.itemId}:${target.childId}`;
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
	if (target.type === 'widget')
		return typeof target.itemId === 'string' && typeof target.childId === 'string';
	return false;
}
