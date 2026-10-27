import type { BroadcastGraphicConfig } from '../../shared/types/graphics';

/**
 * Graphics documents as they were recorded while Graphic Style Sets existed:
 * linked to one, with its references beside the literal values.
 */

/** Matches a Style Set link anywhere in a serialised document. */
export const GRAPHIC_STYLE_SET_LINK_KEYS = /"style(?:Set|Refs)"/;

const ITEM_STYLE_REFS = {
	'typography': {
		entryId: 'heading',
		overrides: { fontSize: 30 },
	},
	'surfaceStyle.fill': { entryId: 'accent' },
};

function isGraphicItem(value: Record<string, unknown>): boolean {
	return typeof value.type === 'string' && typeof value.id === 'string' && typeof value.visible === 'boolean';
}

function linkItems(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map(linkItems);
	if (typeof value !== 'object' || value === null)
		return value;
	const linked = Object.fromEntries(Object.entries(value).map(([key, entry]) => [
		key,
		linkItems(entry),
	]));
	return isGraphicItem(linked)
		? { ...linked, styleRefs: ITEM_STYLE_REFS }
		: linked;
}

/** Every Graphic Item in `document`, Graphic Group children included, carrying `styleRefs`. */
export function withFormerItemStyleRefs<T>(document: T): T {
	return linkItems(document) as T;
}

/** A Broadcast Graphic linked to a Style Set, as were each of its Graphic Items. */
export function withFormerStyleSetLink(graphic: BroadcastGraphicConfig): BroadcastGraphicConfig {
	return {
		...withFormerItemStyleRefs(graphic),
		styleSet: { styleSetId: 'show-style', revision: 3 },
		styleRefs: {
			'animation.enter': { entryId: 'motion' },
		},
	} as BroadcastGraphicConfig;
}
