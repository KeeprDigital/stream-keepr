import type { GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlaySelectionTarget } from './selection';
import type { GraphicsEditorSelection } from '~/modules/graphics/editor/host';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { findGraphicItem } from '~~/shared/modules/graphics';
import { CANVAS_SELECTION } from '~/modules/graphics/editor/host';

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
export type FeatureMatchLayoutEditorSelection = GraphicsEditorSelection<FeatureMatchLayoutEditorLayer>;

/** One layer of the layout: a Source Item, or a Graphic Item of the composition. */
export type FeatureMatchLayoutEditorLayer
	=	| { type: 'source'; itemId: string }
		| { type: 'item'; itemId: string };

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

/** The name of the layer the selection names, or nothing for the canvas or a layer no longer in this layout. */
export function editorSelectionLabel(layout: FeatureMatchLayoutConfig, selection: FeatureMatchLayoutEditorSelection): string | undefined {
	return editorSelectionLayer(layout, selection)?.label;
}
