import type { BroadcastGraphicConfig, GraphicGroupItemConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import { findGraphicItem } from '~~/shared/modules/graphics';

/** The selection target shared by every surface of the graphics compositor. */
export type GraphicsSelectionTarget
	=	| { type: 'canvas' }
		| { type: 'graphic'; graphicId: string }
		| { type: 'item'; graphicId: string; itemId: string };

/**
 * A selection target resolved against a Screen's stack of Broadcast Graphics.
 *
 * A Graphic Group child resolves as an ordinary item selection carrying the
 * Graphic Group it belongs to, because Graphic Item ids are unique within one
 * Broadcast Graphic and Graphic Groups do not nest.
 */
export type GraphicsSelection
	=	| { kind: 'canvas' }
		| { kind: 'graphic'; graphic: BroadcastGraphicConfig }
		| { kind: 'item'; graphic: BroadcastGraphicConfig; item: GraphicItemConfig; group?: GraphicGroupItemConfig }
		| { kind: 'missing' };

export function resolveGraphicsSelection(
	graphics: readonly BroadcastGraphicConfig[],
	target: GraphicsSelectionTarget,
): GraphicsSelection {
	if (target.type === 'canvas')
		return { kind: 'canvas' };

	const graphic = graphics.find(candidate => candidate.id === target.graphicId);
	if (!graphic)
		return { kind: 'missing' };

	if (target.type === 'graphic')
		return { kind: 'graphic', graphic };

	const location = findGraphicItem(graphic, target.itemId);
	return location ? { kind: 'item', graphic, item: location.item, group: location.group } : { kind: 'missing' };
}

/** Stable identity key for a selection target (tree nodes, comparisons). */
export function graphicsSelectionKey(target: GraphicsSelectionTarget): string {
	if (target.type === 'canvas')
		return 'canvas';
	if (target.type === 'graphic')
		return `graphic:${target.graphicId}`;
	return `item:${target.graphicId}:${target.itemId}`;
}

/** Runtime guard for selection targets crossing a postMessage boundary. */
export function isGraphicsSelectionTarget(value: unknown): value is GraphicsSelectionTarget {
	if (typeof value !== 'object' || value === null)
		return false;
	const target = value as Record<string, unknown>;
	if (target.type === 'canvas')
		return true;
	if (target.type === 'graphic')
		return typeof target.graphicId === 'string';
	if (target.type === 'item')
		return typeof target.graphicId === 'string' && typeof target.itemId === 'string';
	return false;
}

/** The Broadcast Graphic a target points into, if any. */
export function graphicsSelectionGraphicId(target: GraphicsSelectionTarget): string | null {
	return target.type === 'canvas' ? null : target.graphicId;
}
