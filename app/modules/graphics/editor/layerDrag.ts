import type { GraphicsEditorLayer, GraphicsEditorTree } from './host';
import type { GraphicItemPlacement, GraphicItemPlacementRefusal } from '~~/shared/modules/graphics';
import { findGraphicItem, graphicItemPlacementRefusal, placeGraphicItem } from '~~/shared/modules/graphics';
import { isSameLayer } from './host';

/**
 * Dragging one row of the graphics editor's layer list (#741), and its keyboard
 * alternative, "Move to group".
 *
 * Pure. A row lands in front of or behind another row of its own section — the
 * Graphic Items of one composition, or a host's own layers, which never mix — or
 * at the front of a Graphic Group. Moving a Graphic Item into or out of a group
 * keeps it drawn where it was, and a refused move says why (`placeGraphicItem`).
 * v1 drags a single row.
 */

/** Where a dragged row lands, relative to a row of its own section. */
export type LayerPlace<L extends GraphicsEditorLayer>
	= | { kind: 'in-front-of' | 'behind'; of: L }
		/** At the front of a Graphic Group's children. */
		| { kind: 'into'; groupId: string };

/**
 * Where the drop indicator is drawn: a row's top or bottom edge, the row itself
 * for a group taking the layer in, or below a group's last child for a layer
 * landing behind the whole group.
 */
export type LayerDropEdge = 'top' | 'bottom' | 'inside' | 'below-group';

export interface LayerDrop<L extends GraphicsEditorLayer> {
	/** The key of the row the indicator is drawn on. */
	row: string;
	edge: LayerDropEdge;
	place: LayerPlace<L>;
	/** Why the layer cannot land there, or null when it can. */
	refusal: GraphicItemPlacementRefusal | null;
}

/** Whether two layers reorder among each other: Graphic Items of one composition, or host-owned siblings. */
function sameSection<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, document: D, a: L, b: L): boolean {
	const itemA = tree.item(document, a);
	const itemB = tree.item(document, b);
	if (itemA || itemB)
		return itemA !== null && itemB !== null && itemA.composition.id === itemB.composition.id;
	return tree.owned?.siblings(document, a).some(sibling => isSameLayer(tree, sibling, b)) ?? false;
}

/**
 * Where a row dropped `fraction` of the way down another row lands: the upper half
 * in front of it, the lower half behind it. A Graphic Group's row takes a Graphic
 * Item in below its upper third — and puts it behind below its lower third, while
 * the group has no children to drop behind instead. The lowest quarter of a
 * group's last child puts the layer behind the whole group. A group never goes
 * into a group. Null where the row cannot land at all.
 */
export function layerDropAt<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	dragged: L,
	over: L,
	fraction: number,
): LayerDrop<L> | null {
	if (!sameSection(tree, document, dragged, over) || isSameLayer(tree, dragged, over))
		return null;

	const row = tree.key(over);
	const beside = (): LayerPlace<L> => ({
		kind: fraction < 0.5
			? 'in-front-of'
			: 'behind',
		of: over,
	});
	const edgeOf = (place: LayerPlace<L>): LayerDropEdge => place.kind === 'in-front-of'
		? 'top'
		: 'bottom';

	const draggedItem = tree.item(document, dragged);
	const overItem = tree.item(document, over);
	if (!draggedItem || !overItem) {
		const place = beside();
		return {
			row,
			edge: edgeOf(place),
			place,
			refusal: null,
		};
	}

	const composition = draggedItem.composition;
	const target = findGraphicItem(composition, overItem.itemId);
	const moving = findGraphicItem(composition, draggedItem.itemId);
	if (!target || !moving)
		return null;
	const draggingGroup = moving.item.type === 'group';

	let edge: LayerDropEdge;
	let place: LayerPlace<L>;
	if (target.group) {
		const isLastRow = target.group.children[0]?.id === overItem.itemId;
		if (isLastRow && fraction >= 0.75) {
			edge = 'below-group';
			place = {
				kind: 'behind',
				of: tree.itemLayer(composition, target.group.id),
			};
		}
		else if (draggingGroup) {
			return null;
		}
		else {
			place = beside();
			edge = edgeOf(place);
		}
	}
	else if (target.item.type === 'group') {
		const empty = target.item.children.length === 0;
		if (draggingGroup) {
			place = empty
				? beside()
				: { kind: 'in-front-of', of: over };
			edge = edgeOf(place);
		}
		else if (fraction < 1 / 3) {
			place = { kind: 'in-front-of', of: over };
			edge = 'top';
		}
		else if (empty && fraction >= 2 / 3) {
			place = { kind: 'behind', of: over };
			edge = 'bottom';
		}
		else {
			place = { kind: 'into', groupId: overItem.itemId };
			edge = 'inside';
		}
	}
	else {
		place = beside();
		edge = edgeOf(place);
	}

	if (place.kind !== 'into' && isSameLayer(tree, place.of, dragged))
		return null;

	const destinationGroup = place.kind === 'into'
		? place.groupId
		: findGraphicItem(composition, tree.item(document, place.of)!.itemId)?.group?.id ?? null;
	return {
		row,
		edge,
		place,
		refusal: graphicItemPlacementRefusal(composition, draggedItem.itemId, destinationGroup),
	};
}

/** The index in front of or behind `of` among its siblings, once the dragged layer has left them. */
function besideIndex(siblings: readonly string[], dragged: string, of: string, kind: 'in-front-of' | 'behind'): number {
	const remaining = siblings.filter(id => id !== dragged);
	const index = remaining.indexOf(of);
	return kind === 'in-front-of'
		? index + 1
		: index;
}

/** Drop one layer at a place. Answers the same document when it changes nothing or is refused. */
export function dropLayer<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	dragged: L,
	place: LayerPlace<L>,
): D {
	const draggedItem = tree.item(document, dragged);
	if (!draggedItem) {
		if (place.kind === 'into' || !tree.owned || !sameSection(tree, document, dragged, place.of))
			return document;
		const siblings = tree.owned.siblings(document, dragged).map(sibling => tree.key(sibling));
		const index = besideIndex(siblings, tree.key(dragged), tree.key(place.of), place.kind);
		return index < 0
			? document
			: tree.owned.reorder(document, dragged, index);
	}

	const composition = draggedItem.composition;
	let placement: GraphicItemPlacement;
	if (place.kind === 'into') {
		placement = { groupId: place.groupId, index: Number.MAX_SAFE_INTEGER };
	}
	else {
		const of = tree.item(document, place.of);
		const target = of && of.composition.id === composition.id
			? findGraphicItem(composition, of.itemId)
			: null;
		if (!of || !target)
			return document;
		const siblings = target.group?.children ?? composition.items;
		placement = {
			groupId: target.group?.id ?? null,
			index: besideIndex(siblings.map(sibling => sibling.id), draggedItem.itemId, of.itemId, place.kind),
		};
	}
	const next = placeGraphicItem(composition, draggedItem.itemId, placement);
	return next === composition
		? document
		: tree.withComposition(document, next);
}

/** One "Move to group" entry: a group to move into, or out of the layer's own. */
export interface LayerGroupMove<L extends GraphicsEditorLayer> {
	label: string;
	place: LayerPlace<L>;
	refusal: GraphicItemPlacementRefusal | null;
}

/**
 * Where "Move to group" can take a Graphic Item: out of its own group, landing
 * in front of it, then into each other group of its composition, front to back.
 * A Graphic Group and a host-owned layer have none.
 */
export function layerGroupMoves<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layer: L,
): LayerGroupMove<L>[] {
	const item = tree.item(document, layer);
	const location = item && findGraphicItem(item.composition, item.itemId);
	if (!item || !location || location.item.type === 'group')
		return [];
	const { composition } = item;

	const moves: LayerGroupMove<L>[] = [];
	if (location.group) {
		moves.push({
			label: `Out of ${location.group.label}`,
			place: {
				kind: 'in-front-of',
				of: tree.itemLayer(composition, location.group.id),
			},
			refusal: null,
		});
	}
	for (const candidate of [...composition.items].reverse()) {
		if (candidate.type !== 'group' || candidate.id === location.group?.id)
			continue;
		moves.push({
			label: candidate.label,
			place: { kind: 'into', groupId: candidate.id },
			refusal: graphicItemPlacementRefusal(composition, item.itemId, candidate.id),
		});
	}
	return moves;
}
