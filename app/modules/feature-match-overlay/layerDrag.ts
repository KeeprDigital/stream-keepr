import type { GraphicItemPlacementRefusal } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import { findGraphicItem, graphicItemPlacementRefusal, placeGraphicItem } from '~~/shared/modules/graphics';
import { editorSelectionKey } from './editorSelection';
import { setSourceOrder } from './layout';

/**
 * Dragging one row of the Feature Match Overlay layer list (#741), and its
 * keyboard alternative, "Move to group".
 *
 * Pure. A row lands in front of or behind another row of its own section —
 * Graphic Items or Sources, which never mix — or at the front of a Graphic
 * Group. Moving a Graphic Item into or out of a group keeps it drawn where it was,
 * and a refused move says why (`placeGraphicItem`). v1 drags a single row.
 */

/** Where a dragged row lands, relative to a row of its own section. */
export type LayerPlace
	= | { kind: 'in-front-of' | 'behind'; of: FeatureMatchLayoutEditorLayer }
		/** At the front of a Graphic Group's children. */
		| { kind: 'into'; groupId: string };

/**
 * Where the drop indicator is drawn: a row's top or bottom edge, the row itself
 * for a group taking the layer in, or below a group's last child for a layer
 * landing behind the whole group.
 */
export type LayerDropEdge = 'top' | 'bottom' | 'inside' | 'below-group';

export interface LayerDrop {
	/** The key of the row the indicator is drawn on. */
	row: string;
	edge: LayerDropEdge;
	place: LayerPlace;
	/** Why the layer cannot land there, or null when it can. */
	refusal: GraphicItemPlacementRefusal | null;
}

/** The Graphic Group a layer would sit in once placed. */
function destinationGroup(composition: BroadcastGraphicConfig, place: LayerPlace): string | null {
	if (place.kind === 'into')
		return place.groupId;
	return findGraphicItem(composition, place.of.itemId)?.group?.id ?? null;
}

/**
 * Where a row dropped `fraction` of the way down another row lands: the upper half
 * in front of it, the lower half behind it. A Graphic Group's row takes a Graphic
 * Item in below its upper third — and puts it behind below its lower third, while
 * the group has no children to drop behind instead. The lowest quarter of a
 * group's last child puts the layer behind the whole group. A group never goes
 * into a group. Null where the row cannot land at all.
 */
export function layerDropAt(
	layout: FeatureMatchLayoutConfig,
	dragged: FeatureMatchLayoutEditorLayer,
	over: FeatureMatchLayoutEditorLayer,
	fraction: number,
): LayerDrop | null {
	if (dragged.type !== over.type || dragged.itemId === over.itemId)
		return null;
	const row = editorSelectionKey(over);
	const beside = (): LayerDrop['place'] => ({
		kind: fraction < 0.5
			? 'in-front-of'
			: 'behind',
		of: over,
	});
	const edgeOf = (place: LayerPlace): LayerDropEdge => place.kind === 'in-front-of'
		? 'top'
		: 'bottom';

	if (dragged.type === 'source') {
		const place = beside();
		return {
			row,
			edge: edgeOf(place),
			place,
			refusal: null,
		};
	}

	const composition = layout.composition;
	const target = findGraphicItem(composition, over.itemId);
	const moving = findGraphicItem(composition, dragged.itemId);
	if (!target || !moving)
		return null;
	const draggingGroup = moving.item.type === 'group';

	let edge: LayerDropEdge;
	let place: LayerPlace;
	if (target.group) {
		const isLastRow = target.group.children[0]?.id === over.itemId;
		if (isLastRow && fraction >= 0.75) {
			edge = 'below-group';
			place = {
				kind: 'behind',
				of: { type: 'item', itemId: target.group.id },
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
			place = { kind: 'into', groupId: over.itemId };
			edge = 'inside';
		}
	}
	else {
		place = beside();
		edge = edgeOf(place);
	}

	if (place.kind !== 'into' && place.of.itemId === dragged.itemId)
		return null;
	return {
		row,
		edge,
		place,
		refusal: graphicItemPlacementRefusal(composition, dragged.itemId, destinationGroup(composition, place)),
	};
}

/** The index in front of or behind `of` among its siblings, once the dragged layer has left them. */
function besideIndex(siblingIds: readonly string[], draggedId: string, place: Extract<LayerPlace, { of: unknown }>): number {
	const remaining = siblingIds.filter(id => id !== draggedId);
	const index = remaining.indexOf(place.of.itemId);
	return place.kind === 'in-front-of'
		? index + 1
		: index;
}

/** Drop one layer at a place. Answers the same layout when it changes nothing or is refused. */
export function dropLayer(
	layout: FeatureMatchLayoutConfig,
	dragged: FeatureMatchLayoutEditorLayer,
	place: LayerPlace,
): FeatureMatchLayoutConfig {
	if (dragged.type === 'source') {
		if (place.kind === 'into' || place.of.type !== 'source')
			return layout;
		const index = besideIndex(layout.sources.map(source => source.id), dragged.itemId, place);
		return index < 0
			? layout
			: setSourceOrder(layout, dragged.itemId, index);
	}

	const composition = layout.composition;
	let placement: { groupId: string | null; index: number };
	if (place.kind === 'into') {
		placement = { groupId: place.groupId, index: Number.MAX_SAFE_INTEGER };
	}
	else {
		const target = findGraphicItem(composition, place.of.itemId);
		if (place.of.type !== 'item' || !target)
			return layout;
		const siblings = target.group?.children ?? composition.items;
		placement = {
			groupId: target.group?.id ?? null,
			index: besideIndex(siblings.map(sibling => sibling.id), dragged.itemId, place),
		};
	}
	const next = placeGraphicItem(composition, dragged.itemId, placement);
	return next === composition
		? layout
		: { ...layout, composition: next };
}

/** One "Move to group" entry: a group to move into, or out of the layer's own. */
export interface LayerGroupMove {
	label: string;
	place: LayerPlace;
	refusal: GraphicItemPlacementRefusal | null;
}

/**
 * Where "Move to group" can take a Graphic Item: out of its own group, landing
 * in front of it, then into each other group, front to back. A Graphic Group and
 * a Source Item have none.
 */
export function layerGroupMoves(layout: FeatureMatchLayoutConfig, layer: FeatureMatchLayoutEditorLayer): LayerGroupMove[] {
	if (layer.type !== 'item')
		return [];
	const composition = layout.composition;
	const location = findGraphicItem(composition, layer.itemId);
	if (!location || location.item.type === 'group')
		return [];
	const moves: LayerGroupMove[] = [];
	if (location.group) {
		moves.push({
			label: `Out of ${location.group.label}`,
			place: {
				kind: 'in-front-of',
				of: { type: 'item', itemId: location.group.id },
			},
			refusal: null,
		});
	}
	for (const item of [...composition.items].reverse()) {
		if (item.type !== 'group' || item.id === location.group?.id)
			continue;
		moves.push({
			label: item.label,
			place: { kind: 'into', groupId: item.id },
			refusal: graphicItemPlacementRefusal(composition, layer.itemId, item.id),
		});
	}
	return moves;
}
