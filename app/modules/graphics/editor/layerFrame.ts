import type { GraphicAnchorPoint, GraphicRect } from '~~/shared/types/graphics';
import type { GraphicsEditorLayer, GraphicsEditorSelection, GraphicsEditorTree } from './host';
import type { SnapLines } from '~/modules/graphics/canvasManipulation';
import { unionBox } from '~/modules/graphics/canvasAlignment';
import { canvasSnapLines, isTurned, rotatedBounds } from '~/modules/graphics/canvasManipulation';
import { isCanvasSelection, layerConfig, layerItemLocation } from './host';

/**
 * Where the graphics editor's selection sits on the canvas: what the canvas
 * handles move, and what they snap to.
 */
export interface EditorSelectionFrame {
	/** The stored top-left rectangle, in its container's pixels. */
	rect: GraphicRect;
	/** Where the container's origin sits on the canvas. */
	origin: { x: number; y: number };
	/** What the layer snaps to, in its container's pixels. */
	snapLines: SnapLines;
	/**
	 * A Graphic Item's Graphic Rotation in degrees, drawn and turned about its
	 * Graphic Anchor Point. A layer the host owns has none and cannot turn.
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
 * A host-owned layer and a top-level Graphic Item are positioned on the canvas
 * itself, and a child of a canvas-arranged Graphic Group inside its group's padded
 * box. A row or column child is placed by its group, and a rotated group's child
 * would turn with its group as well as by its own rotation, so neither is offered:
 * the property panel still edits them. A rotated item is offered with its rotation.
 */
export function editorSelectionFrame<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: NoInfer<D>,
	selection: GraphicsEditorSelection<NoInfer<L>>,
	canvas: { width: number; height: number },
): EditorSelectionFrame | null {
	if (isCanvasSelection(selection))
		return null;
	const stored = layerConfig(tree, document, selection);
	if (!stored)
		return null;
	// Everything on one canvas shares it, so each layer snaps to the others.
	const snapLines = canvasSnapLines(canvas, tree.canvasLayers(document, selection), stored.id);

	const location = layerItemLocation(tree, document, selection);
	if (!location) {
		return {
			rect: pickRect(stored),
			origin: { x: 0, y: 0 },
			snapLines,
		};
	}
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
 * it there by as much: a host-owned layer, a Graphic Item on the canvas, or a
 * child of an unrotated canvas-arranged group, a rotated one by the box it turns
 * into. A row or column child is placed by its group, and a rotated group's child
 * turns with it, so neither has one.
 */
export function editorLayerCanvasBox<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: NoInfer<D>,
	layer: NoInfer<L>,
): GraphicRect | null {
	const location = layerItemLocation(tree, document, layer);
	if (!location) {
		const stored = layerConfig(tree, document, layer);
		return stored
			? pickRect(stored)
			: null;
	}
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
export function editorLayersFrame<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: NoInfer<D>,
	layers: readonly NoInfer<L>[],
	canvas: { width: number; height: number },
	isLocked: (layer: NoInfer<L>) => boolean = () => false,
): EditorSelectionFrame | null {
	if (layers.length <= 1) {
		return layers[0] && !isLocked(layers[0])
			? editorSelectionFrame(tree, document, layers[0], canvas)
			: null;
	}
	const moving = layers.filter(layer => !isLocked(layer));
	if (moving.length === 0)
		return null;
	const members: GraphicRect[] = [];
	const ids: string[] = [];
	for (const layer of moving) {
		const box = editorLayerCanvasBox(tree, document, layer);
		const stored = layerConfig(tree, document, layer);
		if (!box || !stored)
			return null;
		members.push(box);
		ids.push(stored.id);
	}
	return {
		rect: unionBox(members),
		origin: { x: 0, y: 0 },
		snapLines: canvasSnapLines(canvas, tree.canvasLayers(document, moving[0]!), ids),
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
