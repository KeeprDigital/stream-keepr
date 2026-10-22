import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlaySelectionTarget } from './selection';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { findGraphicItem } from '~~/shared/modules/graphics';

/**
 * The Feature Match Overlay editor's one selection: the canvas (the Frame), one
 * Source Item, or one Graphic Item of the composition.
 *
 * The editor has one layer list and one property panel, so it holds one
 * selection. The two vocabularies beneath it — the host-owned target the Frame
 * and Source Item editors and the preview's host guides speak, and the shared
 * compositor's target its inspector and guide layer speak — are projections of
 * this one, so they can never disagree about what is selected.
 */
export type FeatureMatchLayoutEditorSelection
	=	| { type: 'canvas' }
		| { type: 'source'; itemId: string }
		| { type: 'item'; itemId: string };

export const CANVAS_SELECTION: FeatureMatchLayoutEditorSelection = { type: 'canvas' };

/** The host-owned projection: a Source Item, or the canvas for anything else. */
export function hostSelectionTarget(selection: FeatureMatchLayoutEditorSelection): FeatureMatchOverlaySelectionTarget {
	return selection.type === 'source' ? { type: 'source', itemId: selection.itemId } : { type: 'canvas' };
}

/** The shared compositor's projection: a Graphic Item, or the canvas for anything else. */
export function compositorSelectionTarget(selection: FeatureMatchLayoutEditorSelection): GraphicsSelectionTarget {
	return selection.type === 'item'
		? { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: selection.itemId }
		: { type: 'canvas' };
}

/** A host-owned target, as an editor selection. */
export function fromHostSelectionTarget(target: FeatureMatchOverlaySelectionTarget): FeatureMatchLayoutEditorSelection {
	return target.type === 'source' ? { type: 'source', itemId: target.itemId } : CANVAS_SELECTION;
}

/** A shared compositor target, as an editor selection. A whole-composition target is the canvas. */
export function fromCompositorSelectionTarget(target: GraphicsSelectionTarget): FeatureMatchLayoutEditorSelection {
	return target.type === 'item' ? { type: 'item', itemId: target.itemId } : CANVAS_SELECTION;
}

export function editorSelectionKey(selection: FeatureMatchLayoutEditorSelection): string {
	return selection.type === 'canvas' ? 'canvas' : `${selection.type}:${selection.itemId}`;
}

/** Whether the selection still names something in this layout. */
export function editorSelectionExists(layout: FeatureMatchLayoutConfig, selection: FeatureMatchLayoutEditorSelection): boolean {
	if (selection.type === 'canvas')
		return true;
	if (selection.type === 'source')
		return layout.sources.some(item => item.id === selection.itemId);
	return findGraphicItem(layout.composition, selection.itemId) !== null;
}

/** The name of the layer the selection names, or nothing for the canvas or a layer no longer in this layout. */
export function editorSelectionLabel(layout: FeatureMatchLayoutConfig, selection: FeatureMatchLayoutEditorSelection): string | undefined {
	if (selection.type === 'source')
		return layout.sources.find(item => item.id === selection.itemId)?.label;
	if (selection.type === 'item')
		return findGraphicItem(layout.composition, selection.itemId)?.item.label;
	return undefined;
}

export interface EditorSelectionFrame {
	/** The stored top-left rectangle, in its container's pixels. */
	rect: GraphicRect;
	/** Where the container's origin sits on the canvas. */
	origin: { x: number; y: number };
}

/**
 * Where the selection sits on the canvas, when the canvas can move it directly.
 *
 * A Source Item and a top-level Graphic Item are positioned on the canvas itself,
 * and a child of a canvas-arranged Graphic Group inside its group's padded box. A
 * row or column child is placed by its group, and a rotated item's stored
 * rectangle is not what the author sees, so neither is offered: the property
 * panel still edits both.
 */
export function editorSelectionFrame(
	layout: FeatureMatchLayoutConfig,
	selection: FeatureMatchLayoutEditorSelection,
): EditorSelectionFrame | null {
	if (selection.type === 'canvas')
		return null;

	if (selection.type === 'source') {
		const item = layout.sources.find(candidate => candidate.id === selection.itemId);
		return item ? { rect: pickRect(item), origin: { x: 0, y: 0 } } : null;
	}

	const location = findGraphicItem(layout.composition, selection.itemId);
	if (!location || (location.item.rotation ?? 0) % 360 !== 0)
		return null;
	if (!location.group)
		return { rect: pickRect(location.item), origin: { x: 0, y: 0 } };
	if (location.group.arrangement !== 'canvas')
		return null;
	const padding = Math.max(0, location.group.padding);
	return {
		rect: pickRect(location.item),
		origin: { x: location.group.x + padding, y: location.group.y + padding },
	};
}

function pickRect(rect: GraphicRect): GraphicRect {
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
