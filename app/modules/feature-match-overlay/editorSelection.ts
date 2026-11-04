import type { GraphicAnchorPoint, GraphicItemConfig, GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlaySelectionTarget } from './selection';
import type { SnapLines } from '~/modules/graphics/canvasManipulation';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { findGraphicItem } from '~~/shared/modules/graphics';
import { unionBox } from '~/modules/graphics/canvasAlignment';
import { canvasSnapLines, isTurned, rotatedBounds } from '~/modules/graphics/canvasManipulation';

/**
 * One selection in the Feature Match Overlay editor: the canvas (the Frame), one
 * Source Item, or one Graphic Item of the composition. Several layers selected
 * together are a `LayerSelection` (#740); this names its one layer, or the canvas.
 *
 * The editor has one layer list and one property panel, so it holds one
 * selection. The two vocabularies beneath it — the host-owned target the Frame
 * and Source Item editors and the preview's host guides speak, and the shared
 * compositor's target its inspector and guide layer speak — are projections of
 * this one, so they can never disagree about what is selected.
 */
export type FeatureMatchLayoutEditorSelection
	=	| { type: 'canvas' }
		| FeatureMatchLayoutEditorLayer;

/** One layer of the layout: a Source Item, or a Graphic Item of the composition. */
export type FeatureMatchLayoutEditorLayer
	=	| { type: 'source'; itemId: string }
		| { type: 'item'; itemId: string };

export const CANVAS_SELECTION: FeatureMatchLayoutEditorSelection = { type: 'canvas' };

/** The host-owned projection: a Source Item, or the canvas for anything else. */
export function hostSelectionTarget(selection: FeatureMatchLayoutEditorSelection): FeatureMatchOverlaySelectionTarget {
	return selection.type === 'source'
		? { type: 'source', itemId: selection.itemId }
		: { type: 'canvas' };
}

/** The shared compositor's projection: a Graphic Item, or the canvas for anything else. */
export function compositorSelectionTarget(selection: FeatureMatchLayoutEditorSelection): GraphicsSelectionTarget {
	return selection.type === 'item'
		? { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: selection.itemId }
		: { type: 'canvas' };
}

/** A host-owned target, as an editor selection. */
export function fromHostSelectionTarget(target: FeatureMatchOverlaySelectionTarget): FeatureMatchLayoutEditorSelection {
	return target.type === 'source'
		? { type: 'source', itemId: target.itemId }
		: CANVAS_SELECTION;
}

/** A shared compositor target, as an editor selection. A whole-composition target is the canvas. */
export function fromCompositorSelectionTarget(target: GraphicsSelectionTarget): FeatureMatchLayoutEditorSelection {
	return target.type === 'item'
		? { type: 'item', itemId: target.itemId }
		: CANVAS_SELECTION;
}

export function editorSelectionKey(selection: FeatureMatchLayoutEditorSelection): string {
	return selection.type === 'canvas'
		? 'canvas'
		: `${selection.type}:${selection.itemId}`;
}

/**
 * The stored layer a selection names, a Source Item or a Graphic Item, whose
 * rectangle, name and visibility read alike; nothing for the canvas or a layer
 * no longer in this layout.
 */
export function editorSelectionLayer(
	layout: FeatureMatchLayoutConfig,
	selection: FeatureMatchLayoutEditorSelection,
): FeatureMatchSourceItemConfig | GraphicItemConfig | undefined {
	if (selection.type === 'source')
		return layout.sources.find(item => item.id === selection.itemId);
	if (selection.type === 'item')
		return findGraphicItem(layout.composition, selection.itemId)?.item;
	return undefined;
}

/** Whether the selection still names something in this layout. */
export function editorSelectionExists(layout: FeatureMatchLayoutConfig, selection: FeatureMatchLayoutEditorSelection): boolean {
	return selection.type === 'canvas' || editorSelectionLayer(layout, selection) !== undefined;
}

/** The name of the layer the selection names, or nothing for the canvas or a layer no longer in this layout. */
export function editorSelectionLabel(layout: FeatureMatchLayoutConfig, selection: FeatureMatchLayoutEditorSelection): string | undefined {
	return editorSelectionLayer(layout, selection)?.label;
}

export interface EditorSelectionFrame {
	/** The stored top-left rectangle, in its container's pixels. */
	rect: GraphicRect;
	/** Where the container's origin sits on the canvas. */
	origin: { x: number; y: number };
	/** What the layer snaps to, in its container's pixels. */
	snapLines: SnapLines;
	/**
	 * A Graphic Item's Graphic Rotation in degrees, drawn and turned about its
	 * Graphic Anchor Point. A Source Item has none and cannot turn.
	 */
	rotation?: number;
	anchor?: GraphicAnchorPoint;
	/**
	 * With several layers selected, each one's box on the canvas. They move as one
	 * by the box they cover, `rect`, and are not resized together.
	 */
	members?: GraphicRect[];
}

/**
 * Where the selection sits on the canvas, when the canvas can move it directly.
 *
 * A Source Item and a top-level Graphic Item are positioned on the canvas itself,
 * and a child of a canvas-arranged Graphic Group inside its group's padded box. A
 * row or column child is placed by its group, and a rotated group's child would
 * turn with its group as well as by its own rotation, so neither is offered: the
 * property panel still edits them. A rotated item is offered with its rotation.
 */
export function editorSelectionFrame(
	layout: FeatureMatchLayoutConfig,
	selection: FeatureMatchLayoutEditorSelection,
	canvas: { width: number; height: number },
): EditorSelectionFrame | null {
	if (selection.type === 'canvas')
		return null;
	// Source Items and top-level Graphic Items share the canvas, so each snaps to the others.
	const snapLines = canvasSnapLines(canvas, [
		...layout.sources,
		...layout.composition.items,
	], selection.itemId);

	if (selection.type === 'source') {
		const item = layout.sources.find(candidate => candidate.id === selection.itemId);
		return item
			? {
					rect: pickRect(item),
					origin: { x: 0, y: 0 },
					snapLines,
				}
			: null;
	}

	const location = findGraphicItem(layout.composition, selection.itemId);
	if (!location)
		return null;
	const turn = {
		rotation: location.item.rotation ?? 0,
		anchor: location.item.anchor,
	};
	if (!location.group) {
		return {
			rect: pickRect(location.item),
			origin: { x: 0, y: 0 },
			snapLines,
			...turn,
		};
	}
	if (location.group.arrangement !== 'canvas' || isTurned(location.group.rotation))
		return null;
	const padding = Math.max(0, location.group.padding);
	return {
		rect: pickRect(location.item),
		origin: { x: location.group.x + padding, y: location.group.y + padding },
		snapLines,
		...turn,
	};
}

/**
 * The box a layer covers on the canvas, when moving its stored rectangle moves
 * it there by as much: a Source Item, a Graphic Item on the canvas, or a child of
 * an unrotated canvas-arranged group, a rotated one by the box it turns into. A
 * row or column child is placed by its group, and a rotated group's child turns
 * with it, so neither has one.
 */
export function editorLayerCanvasBox(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer): GraphicRect | null {
	if (layer.type === 'source') {
		const item = layout.sources.find(candidate => candidate.id === layer.itemId);
		return item
			? pickRect(item)
			: null;
	}
	const location = findGraphicItem(layout.composition, layer.itemId);
	if (!location)
		return null;
	const { group, item } = location;
	if (group && (group.arrangement !== 'canvas' || isTurned(group.rotation)))
		return null;
	const padding = group
		? Math.max(0, group.padding)
		: 0;
	const covered = rotatedBounds(item, item.rotation, item.anchor);
	return {
		...covered,
		x: covered.x + (group
			? group.x + padding
			: 0),
		y: covered.y + (group
			? group.y + padding
			: 0),
	};
}

/**
 * Where the selected layers sit on the canvas, when the canvas can move them.
 *
 * One layer is framed as `editorSelectionFrame` frames it. Several move together
 * by the box they cover, in canvas pixels, which snaps as one to everything else
 * (#740): a delta in canvas pixels is the same delta in a canvas-arranged group's
 * padded box, and moves a rotated layer by as much. If the canvas cannot move
 * one of them, it moves none.
 *
 * A locked layer is left where it is (#747), and stays something to snap to: one
 * locked layer offers nothing, and several move only their unlocked ones, still
 * only moving when one is left.
 */
export function editorLayersFrame(
	layout: FeatureMatchLayoutConfig,
	layers: readonly FeatureMatchLayoutEditorLayer[],
	canvas: { width: number; height: number },
	isLocked: (layer: FeatureMatchLayoutEditorLayer) => boolean = () => false,
): EditorSelectionFrame | null {
	if (layers.length <= 1) {
		return layers[0] && !isLocked(layers[0])
			? editorSelectionFrame(layout, layers[0], canvas)
			: null;
	}
	const moving = layers.filter(layer => !isLocked(layer));
	if (moving.length === 0)
		return null;
	const members: GraphicRect[] = [];
	for (const layer of moving) {
		const box = editorLayerCanvasBox(layout, layer);
		if (!box)
			return null;
		members.push(box);
	}
	return {
		rect: unionBox(members),
		origin: { x: 0, y: 0 },
		snapLines: canvasSnapLines(canvas, [
			...layout.sources,
			...layout.composition.items,
		], moving.map(layer => layer.itemId)),
		members,
	};
}

function pickRect(rect: GraphicRect): GraphicRect {
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
	};
}
