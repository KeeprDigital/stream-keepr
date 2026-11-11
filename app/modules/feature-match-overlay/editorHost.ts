import type { MaybeRefOrGetter, Ref } from 'vue';
import type { FeatureMatchLayoutConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from './editorSelection';
import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { GraphicsEditorHostContract, GraphicsEditorLayerPatch, GraphicsEditorTree } from '~/modules/graphics/editor/host';
import { toValue } from 'vue';
import { FEATURE_MATCH_OVERLAY_HOST_CONTRACT, withoutLayerLock } from '~~/shared/modules/graphics';
import { copyGraphicLayers, pasteFeatureMatchLayers } from '~/modules/graphics/clipboard';
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
		...[...layout.composition.items].reverse().flatMap(item => [
			{ type: 'item' as const, itemId: item.id },
			...(item.type === 'group'
				? [...item.children].reverse().map(child => ({ type: 'item' as const, itemId: child.id }))
				: []),
		]),
		...[...layout.sources].reverse().map(source => sourceLayer(source.id)),
	],
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
		create: (layout) => {
			const result = layoutWriter.createSourceItem(layout);
			return { document: result.layout, layer: sourceLayer(result.id) };
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

export interface FeatureMatchLayoutEditorHostOptions {
	config: Ref<FeatureMatchOverlayModeConfig>;
	updateConfig: (partial: Partial<FeatureMatchOverlayModeConfig>) => void;
	canvasWidth: MaybeRefOrGetter<number>;
	canvasHeight: MaybeRefOrGetter<number>;
	/** Whether this session holds the Screen's Graphics Authoring Lease (#738). */
	writable: MaybeRefOrGetter<boolean>;
	/**
	 * Whether a Feature Match Layout Template placement is in flight. The server is
	 * rewriting the layout, so the editor writes nothing until the placed one is held.
	 */
	held?: MaybeRefOrGetter<boolean>;
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
		forbidden: {
			writable: () => toValue(options.writable),
			held: () => toValue(options.held) ?? false,
		},
		canvas: () => ({
			width: toValue(options.canvasWidth),
			height: toValue(options.canvasHeight),
		}),
	};
}
