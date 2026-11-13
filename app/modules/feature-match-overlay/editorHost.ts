import type { Ref } from 'vue';
import type { EventKind } from '~~/shared/config/games';
import type { FeatureMatchLayoutConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { GraphicsEditorHostContract, GraphicsEditorLayerPatch, GraphicsEditorSessionOptions, GraphicsEditorTree } from '~/modules/graphics/editor/host';
import { FEATURE_MATCH_SOURCE_ITEM_ICON } from '~~/shared/featureMatchSourceItems';
import { FEATURE_MATCH_OVERLAY_HOST_CONTRACT, featureMatchOverlayHostContract, withoutLayerLock } from '~~/shared/modules/graphics';
import { copyGraphicLayers, pasteFeatureMatchLayers } from '~/modules/graphics/clipboard';
import { compositionItemLayers, graphicsEditorSession } from '~/modules/graphics/editor/host';
import { editorSelectionKey } from './editorSelection';
import * as layoutWriter from './layout';

/**
 * The Feature Match Overlay's half of the shared graphics editor's Host Contract.
 *
 * The document is one Feature Match Layout. It holds one composition, whose
 * Graphic Items the editor writes itself, and the Source Items, which this host
 * owns: they are listed after the Graphic Items, reorder only among themselves,
 * and never join a Graphic Group. Both share the one canvas, so each snaps to the
 * other. The Frame is the canvas, not a layer.
 */

type Layout = FeatureMatchLayoutConfig;
type Layer = FeatureMatchLayoutEditorLayer;

export type FeatureMatchLayoutEditor = GraphicsEditor<Layout, Layer>;

const sourceLayer = (itemId: string): Layer => ({ type: 'source', itemId });

/** A patch as a Source Item stores it: unlocking drops the field, so it is stored as one never locked. */
function patchSource(layout: Layout, id: string, { locked, ...fields }: GraphicsEditorLayerPatch): Layout {
	const patched = layoutWriter.patchSource(layout, id, locked
		? { ...fields, locked: true }
		: fields);
	return locked === false
		? {
				...patched,
				sources: patched.sources.map(source => source.id === id
					? withoutLayerLock(source)
					: source),
			}
		: patched;
}

export const FEATURE_MATCH_LAYOUT_EDITOR_TREE: GraphicsEditorTree<Layout, Layer> = {
	host: FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	key: editorSelectionKey,
	order: layout => [
		...compositionItemLayers(layout.composition, (itemId): Layer => ({ type: 'item', itemId })),
		...[...layout.sources].reverse().map(source => sourceLayer(source.id)),
	],
	compositions: layout => [layout.composition],
	item: (layout, layer) => layer.type === 'item'
		? { composition: layout.composition, itemId: layer.itemId }
		: null,
	itemLayer: (_, itemId) => ({ type: 'item', itemId }),
	destination: layout => layout.composition,
	withComposition: (layout, composition) => ({ ...layout, composition }),
	canvasLayers: layout => [
		...layout.sources,
		...layout.composition.items,
	],
	owned: {
		label: 'Source Item',
		icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
		create: (layout) => {
			const result = layoutWriter.createSourceItem(layout);
			return {
				document: result.layout,
				layer: sourceLayer(result.id),
			};
		},
		find: (layout, layer) => layout.sources.find(source => source.id === layer.itemId),
		siblings: layout => layout.sources.map(source => sourceLayer(source.id)),
		patch: (layout, layer, patch) => patchSource(layout, layer.itemId, patch),
		remove: (layout, layer) => layoutWriter.removeSource(layout, layer.itemId),
		duplicate: (layout, layer) => {
			const result = layoutWriter.duplicateSource(layout, layer.itemId);
			return {
				document: result.layout,
				layer: result.id
					? sourceLayer(result.id)
					: null,
			};
		},
		reorder: (layout, layer, index) => layoutWriter.setSourceOrder(layout, layer.itemId, index),
	},
	copy: (layout, layers) => copyGraphicLayers('feature-match-overlay', layout, layers),
	paste: (copied, layout, into) => {
		const outcome = pasteFeatureMatchLayers(copied, layout, into);
		return outcome.ok
			? { ok: true, document: outcome.layout, pasted: outcome.pasted }
			: outcome;
	},
};

const EDITOR_TREES = new Map<EventKind, GraphicsEditorTree<Layout, Layer>>();

/**
 * The editor tree as an Event of this kind authors it: its palette offers what
 * that Event's host supplies, a Commander Event's Commander Damage among them
 * (ADR-0087).
 */
export function featureMatchLayoutEditorTree(kind: EventKind): GraphicsEditorTree<Layout, Layer> {
	let tree = EDITOR_TREES.get(kind);
	if (!tree) {
		tree = {
			...FEATURE_MATCH_LAYOUT_EDITOR_TREE,
			host: featureMatchOverlayHostContract(kind),
		};
		EDITOR_TREES.set(kind, tree);
	}
	return tree;
}

/** `held`: a Feature Match Layout Template placement is in flight, so the editor writes nothing until the placed layout is held. */
export interface FeatureMatchLayoutEditorHostOptions extends GraphicsEditorSessionOptions {
	config: Ref<FeatureMatchOverlayModeConfig>;
	updateConfig: (partial: Partial<FeatureMatchOverlayModeConfig>) => void;
}

/**
 * The editor writes the layout, and only the layout: the Feature Match Slot and
 * the canvas size are what the Screen points at and how big it is, not authored
 * layout, so neither is undone. Nothing in the layout is forbidden beyond the
 * lease and a placement in flight.
 */
export function featureMatchLayoutEditorHost(options: FeatureMatchLayoutEditorHostOptions): GraphicsEditorHostContract<Layout, Layer> {
	return {
		tree: FEATURE_MATCH_LAYOUT_EDITOR_TREE,
		document: {
			read: () => options.config.value.layout,
			write: layout => options.updateConfig({ layout }),
		},
		...graphicsEditorSession(options),
	};
}
