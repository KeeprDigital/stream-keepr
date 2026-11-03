import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import type { AlignEdge, BoxMove, DistributeAxis } from '~/modules/graphics/canvasAlignment';
import { findGraphicItem } from '~~/shared/modules/graphics';
import { alignBoxes, distributeBoxes } from '~/modules/graphics/canvasAlignment';
import { rotatedBounds } from '~/modules/graphics/canvasManipulation';
import { editorLayerCanvasBox, editorSelectionLayer } from './editorSelection';

/**
 * Aligning and distributing the Feature Match Overlay editor's selected layers
 * (#919): which of them move, and in which container's pixels.
 *
 * Pure. Source Items and Graphic Items align together (E8). Several align to the
 * bounds they cover, and one to its container (E10): the canvas, or a group
 * child's group's padded box. Each counts by the box it covers, a rotated one by
 * the axis-aligned box it turns into, as snapping counts it.
 *
 * Children of one Graphic Group align within their group, which may be rotated.
 * Among canvas layers a child of an unrotated canvas-arranged group counts by
 * where it sits on the canvas, and moves within its group by as much. A row or
 * column child is placed by its group, and a rotated group's child turns with it,
 * so neither moves among canvas layers; the rest still do.
 */

/** The align commands the property panel and the layer list offer, in their order. */
export const ALIGN_COMMANDS: readonly { edge: AlignEdge; label: string; icon: string }[] = [
	{ edge: 'left', label: 'Left', icon: 'i-lucide-align-start-vertical' },
	{ edge: 'center', label: 'Centre', icon: 'i-lucide-align-center-vertical' },
	{ edge: 'right', label: 'Right', icon: 'i-lucide-align-end-vertical' },
	{ edge: 'top', label: 'Top', icon: 'i-lucide-align-start-horizontal' },
	{ edge: 'middle', label: 'Middle', icon: 'i-lucide-align-center-horizontal' },
	{ edge: 'bottom', label: 'Bottom', icon: 'i-lucide-align-end-horizontal' },
];

/** The distribute commands the property panel and the layer list offer. */
export const DISTRIBUTE_COMMANDS: readonly { axis: DistributeAxis; label: string; icon: string }[] = [
	{ axis: 'x', label: 'Horizontally', icon: 'i-lucide-align-horizontal-space-around' },
	{ axis: 'y', label: 'Vertically', icon: 'i-lucide-align-vertical-space-around' },
];

/** Where a layer's stored rectangle moves to. */
export interface LayerPosition {
	layer: FeatureMatchLayoutEditorLayer;
	x: number;
	y: number;
}

interface Member {
	layer: FeatureMatchLayoutEditorLayer;
	/** The stored top-left rectangle. */
	rect: GraphicRect;
	/** The box it covers, in the space they align in. */
	box: GraphicRect;
}

interface AlignmentSpace {
	members: Member[];
	/** What one layer aligns to. */
	container: GraphicRect;
}

/** The Graphic Group a layer is a child of, if any. */
function parentGroup(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer) {
	return layer.type === 'item'
		? findGraphicItem(layout.composition, layer.itemId)?.group
		: undefined;
}

function alignmentSpace(
	layout: FeatureMatchLayoutConfig,
	layers: readonly FeatureMatchLayoutEditorLayer[],
	canvas: { width: number; height: number },
): AlignmentSpace {
	const present = layers.filter((layer) => {
		const group = parentGroup(layout, layer);
		return editorSelectionLayer(layout, layer) !== undefined
			&& (!group || group.arrangement === 'canvas');
	});
	const groups = new Set(present.map(layer => parentGroup(layout, layer)));
	const [group] = groups;
	if (groups.size === 1 && group) {
		const padding = Math.max(0, group.padding);
		return {
			members: present.map((layer) => {
				const item = findGraphicItem(layout.composition, layer.itemId)!.item;
				return {
					layer,
					rect: item,
					box: rotatedBounds(item, item.rotation, item.anchor),
				};
			}),
			container: {
				x: 0,
				y: 0,
				width: Math.max(0, group.width - 2 * padding),
				height: Math.max(0, group.height - 2 * padding),
			},
		};
	}
	return {
		members: present.flatMap((layer) => {
			const box = editorLayerCanvasBox(layout, layer);
			return box
				? [
						{
							layer,
							rect: editorSelectionLayer(layout, layer)!,
							box,
						},
					]
				: [];
		}),
		container: { x: 0, y: 0, ...canvas },
	};
}

function positions(members: readonly Member[], moves: readonly BoxMove[]): LayerPosition[] {
	return members.flatMap(({ layer, rect }, index) => {
		const move = moves[index]!;
		return move.x === 0 && move.y === 0
			? []
			: [
					{ layer, x: rect.x + move.x, y: rect.y + move.y },
				];
	});
}

/** The selected layers an align or distribute moves. */
export function alignableLayers(
	layout: FeatureMatchLayoutConfig,
	layers: readonly FeatureMatchLayoutEditorLayer[],
): FeatureMatchLayoutEditorLayer[] {
	return alignmentSpace(layout, layers, { width: 0, height: 0 }).members.map(member => member.layer);
}

/**
 * Where aligning the selected layers' edge or centre puts each one that moves:
 * several to the bounds the alignable ones cover, one to its container.
 */
export function alignLayers(
	layout: FeatureMatchLayoutConfig,
	layers: readonly FeatureMatchLayoutEditorLayer[],
	canvas: { width: number; height: number },
	edge: AlignEdge,
): LayerPosition[] {
	const { members, container } = alignmentSpace(layout, layers, canvas);
	const to = layers.length > 1
		? undefined
		: container;
	return positions(members, alignBoxes(members.map(member => member.box), edge, to));
}

/**
 * Where spacing the selected layers evenly along an axis puts each one that
 * moves: the outermost two stay. Fewer than three alignable move none.
 */
export function distributeLayers(
	layout: FeatureMatchLayoutConfig,
	layers: readonly FeatureMatchLayoutEditorLayer[],
	axis: DistributeAxis,
): LayerPosition[] {
	const { members } = alignmentSpace(layout, layers, { width: 0, height: 0 });
	return positions(members, distributeBoxes(members.map(member => member.box), axis));
}
