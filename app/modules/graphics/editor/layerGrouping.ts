import type { GraphicItemsGroupRefusal } from '~~/shared/modules/graphics';
import type { GraphicsEditorLayer, GraphicsEditorTree } from './host';
import { graphicItemsGroupRefusal } from '~~/shared/modules/graphics';
import { MAX_GRAPHIC_GROUP_CHILDREN } from '~~/shared/types/graphics';

/** Why ⌘G cannot group the selected layers (#920). */
export type LayerGroupRefusal = 'source-item' | GraphicItemsGroupRefusal;

/**
 * Why the graphics editor cannot group these layers, or null when it can. A layer
 * the host owns, which today is a Source Item, never joins a Graphic Group (E8),
 * so any selected one refuses the whole selection; the rest is the Graphic Items'
 * own rule (`graphicItemsGroupRefusal`), within the composition they sit in.
 */
export function layerGroupRefusal<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layers: readonly L[],
): LayerGroupRefusal | null {
	const items = layers.map(layer => tree.item(document, layer));
	if (items.includes(null))
		return 'source-item';
	const composition = items[0]?.composition;
	return composition
		? graphicItemsGroupRefusal(composition, items.map(item => item!.itemId))
		: 'too-few';
}

/** What the editor shows for each refusal, beside the Group control it disables. */
export const LAYER_GROUP_REFUSAL_REASONS: Record<LayerGroupRefusal, string> = {
	'source-item': 'Source Items can\'t be grouped',
	'too-few': 'Select two or more layers to group them',
	'too-many': `A group holds at most ${MAX_GRAPHIC_GROUP_CHILDREN} layers`,
	'group-into-group': 'A group can\'t go into another group',
	'group-child': 'Layers already in a group can\'t be grouped again',
};
