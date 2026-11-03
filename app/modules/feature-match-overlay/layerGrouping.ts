import type { GraphicItemsGroupRefusal } from '~~/shared/modules/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import { graphicItemsGroupRefusal } from '~~/shared/modules/graphics';

/** Why ⌘G cannot group the selected layers (#920). */
export type LayerGroupRefusal = 'source-item' | GraphicItemsGroupRefusal;

/**
 * Why the Feature Match Overlay editor cannot group these layers, or null when it
 * can. A Source Item is host-owned and never joins a Graphic Group (E8), so any
 * selected one refuses the whole selection; the rest is the Graphic Items' own
 * rule (`graphicItemsGroupRefusal`).
 */
export function layerGroupRefusal(layout: FeatureMatchLayoutConfig, layers: readonly FeatureMatchLayoutEditorLayer[]): LayerGroupRefusal | null {
	if (layers.some(layer => layer.type === 'source'))
		return 'source-item';
	return graphicItemsGroupRefusal(layout.composition, layers.map(layer => layer.itemId));
}

/** What the editor shows for each refusal, beside the Group control it disables. */
export const LAYER_GROUP_REFUSAL_REASONS: Record<LayerGroupRefusal, string> = {
	'source-item': 'Source Items can\'t be grouped',
	'too-few': 'Select two or more layers to group them',
	'group-into-group': 'A group can\'t go into another group',
	'group-child': 'Layers already in a group can\'t be grouped again',
};
