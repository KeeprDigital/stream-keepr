import type { GraphicGroupItemConfig, GraphicRect } from '~~/shared/types/graphics';
import type { GraphicsEditorLayer, GraphicsEditorTree } from './host';
import type { AlignEdge, BoxMove, DistributeAxis } from '~/modules/graphics/canvasAlignment';
import { alignBoxes, distributeBoxes } from '~/modules/graphics/canvasAlignment';
import { rotatedBounds } from '~/modules/graphics/canvasManipulation';
import { layerConfig, layerItemLocation } from './host';
import { editorLayerCanvasBox } from './layerFrame';

/**
 * Aligning and distributing the graphics editor's selected layers (#919): which
 * of them move, and in which container's pixels.
 *
 * Pure. A host's own layers and Graphic Items align together (E8). Several align to the
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

/** The align commands the property panel offers several selected layers, in their order, each along one axis. */
export const ALIGN_COMMANDS: readonly { edge: AlignEdge; axis: DistributeAxis; label: string; icon: string }[] = [
	{
		edge: 'left',
		axis: 'x',
		label: 'Left',
		icon: 'i-lucide-align-start-vertical',
	},
	{
		edge: 'center',
		axis: 'x',
		label: 'Centre',
		icon: 'i-lucide-align-center-vertical',
	},
	{
		edge: 'right',
		axis: 'x',
		label: 'Right',
		icon: 'i-lucide-align-end-vertical',
	},
	{
		edge: 'top',
		axis: 'y',
		label: 'Top',
		icon: 'i-lucide-align-start-horizontal',
	},
	{
		edge: 'middle',
		axis: 'y',
		label: 'Middle',
		icon: 'i-lucide-align-center-horizontal',
	},
	{
		edge: 'bottom',
		axis: 'y',
		label: 'Bottom',
		icon: 'i-lucide-align-end-horizontal',
	},
];

/** The distribute commands the property panel offers three or more selected layers. */
export const DISTRIBUTE_COMMANDS: readonly { axis: DistributeAxis; label: string; icon: string }[] = [
	{ axis: 'x', label: 'Horizontally', icon: 'i-lucide-align-horizontal-space-around' },
	{ axis: 'y', label: 'Vertically', icon: 'i-lucide-align-vertical-space-around' },
];

/** Where a layer's stored rectangle moves to. */
export interface LayerPosition<L extends GraphicsEditorLayer> {
	layer: L;
	x: number;
	y: number;
}

/** A selected layer that aligns. */
interface Member<L extends GraphicsEditorLayer> {
	layer: L;
	/** The stored top-left rectangle. */
	rect: GraphicRect;
	/** The box it covers, in the space they align in. */
	box: GraphicRect;
}

/** The Graphic Group a layer is a child of, if any. */
function parentGroup<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D, layer: L) {
	return layerItemLocation(tree, document, layer)?.group;
}

/**
 * The selected layers that align, and the group whose padded box they align in
 * when they are all its children; otherwise they align on the canvas.
 */
function alignmentMembers<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
): { members: Member<L>[]; group?: GraphicGroupItemConfig } {
	const present = layers.filter((layer) => {
		const group = parentGroup(tree, document, layer);
		return layerConfig(tree, document, layer) !== undefined
			&& (!group || group.arrangement === 'canvas');
	});
	const groups = new Set(present.map(layer => parentGroup(tree, document, layer)));
	const [group] = groups;
	if (groups.size === 1 && group) {
		return {
			group,
			members: present.map((layer) => {
				const item = layerItemLocation(tree, document, layer)!.item;
				return {
					layer,
					rect: item,
					box: rotatedBounds(item, item.rotation, item.anchor),
				};
			}),
		};
	}
	return {
		members: present.flatMap((layer) => {
			const box = editorLayerCanvasBox(tree, document, layer);
			return box
				? [
						{
							layer,
							rect: layerConfig(tree, document, layer)!,
							box,
						},
					]
				: [];
		}),
	};
}

/** What one layer aligns to: its group's padded box, or the canvas. */
function container(group: GraphicGroupItemConfig | undefined, canvas: { width: number; height: number }): GraphicRect {
	if (!group)
		return { x: 0, y: 0, ...canvas };
	const padding = Math.max(0, group.padding);
	return {
		x: 0,
		y: 0,
		width: Math.max(0, group.width - 2 * padding),
		height: Math.max(0, group.height - 2 * padding),
	};
}

function positions<L extends GraphicsEditorLayer>(members: readonly Member<L>[], moves: readonly BoxMove[]): LayerPosition<L>[] {
	return members.flatMap(({ layer, rect }, index) => {
		const move = moves[index]!;
		return move.x === 0 && move.y === 0
			? []
			: [
					{ layer, x: rect.x + move.x, y: rect.y + move.y },
				];
	});
}

/**
 * Whether aligning the selected layers has anything to line up: one that aligns
 * to its container, or two or more that align to each other.
 */
export function canAlignLayers<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
): boolean {
	const { members } = alignmentMembers(tree, document, layers);
	return members.length > 0 && members.length >= Math.min(2, layers.length);
}

/** Whether three or more of the selected layers distribute. */
export function canDistributeLayers<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
): boolean {
	return alignmentMembers(tree, document, layers).members.length >= 3;
}

/**
 * Where aligning the selected layers' edge or centre puts each one that moves:
 * several to the bounds the ones that align cover, one to its container.
 */
export function alignLayers<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
	canvas: { width: number; height: number },
	edge: AlignEdge,
): LayerPosition<L>[] {
	const { members, group } = alignmentMembers(tree, document, layers);
	const to = layers.length > 1
		? undefined
		: container(group, canvas);
	return positions(members, alignBoxes(members.map(member => member.box), edge, to));
}

/**
 * Where spacing the selected layers evenly along an axis puts each one that
 * moves: the outermost two stay. Fewer than three that distribute move none.
 */
export function distributeLayers<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
	axis: DistributeAxis,
): LayerPosition<L>[] {
	const { members } = alignmentMembers(tree, document, layers);
	return positions(members, distributeBoxes(members.map(member => member.box), axis));
}
