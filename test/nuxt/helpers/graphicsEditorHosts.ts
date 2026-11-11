import type { Ref } from 'vue';
import type { BroadcastGraphicConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import type { GraphicsClipboardHost } from '~/modules/graphics/clipboard';
import type { GraphicsEditorLayer } from '~/modules/graphics/editor/host';
import { ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { useGraphicsEditor } from '~/composables/useGraphicsEditor';
import { featureMatchLayoutEditorHost } from '~/modules/feature-match-overlay/editorHost';

/**
 * The shared graphics editor mounted on each host's contract, over a document
 * whose edited composition holds the Graphic Items a case names. A test table
 * runs one case per host; a new host adds one entry to `GRAPHICS_EDITOR_HOSTS`.
 */
export interface GraphicsEditorHarness<D = unknown, L extends GraphicsEditorLayer = GraphicsEditorLayer> {
	editor: GraphicsEditor<D, L>;
	/** Every document the editor wrote, in order. */
	writes: D[];
	/** Whether this session holds the Graphics Authoring Lease. */
	leased: Ref<boolean>;
	/** Whether the host is holding the editor, as a template placement does. */
	held: Ref<boolean>;
	document: () => D;
	/** The layer naming a Graphic Item of the edited composition. */
	layer: (itemId: string) => L;
	/** The edited composition, as stored now. */
	composition: () => BroadcastGraphicConfig;
	/** Replace the edited composition's items, as another session's write would. */
	storeItems: (items: GraphicItemConfig[]) => void;
}

export interface GraphicsEditorHostFixture {
	name: string;
	hostId: GraphicsClipboardHost;
	editing: (options: { writable: boolean; items: GraphicItemConfig[] }) => GraphicsEditorHarness;
}

const CANVAS = { width: 1920, height: 1080 };

/** A Feature Match Overlay editor over the default layout with `items` as its Graphic Items. */
export function featureMatchLayoutEditing(options: { writable: boolean; items?: GraphicItemConfig[] }): GraphicsEditorHarness<
	FeatureMatchOverlayModeConfig['layout'],
	FeatureMatchLayoutEditorLayer
> {
	const config = ref(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
	if (options.items)
		config.value.layout.composition.items = structuredClone(options.items);
	const writes: FeatureMatchOverlayModeConfig['layout'][] = [];
	const leased = ref(options.writable);
	const held = ref(false);
	const editor = useGraphicsEditor(featureMatchLayoutEditorHost({
		config,
		updateConfig: (patch) => {
			if (patch.layout)
				writes.push(patch.layout);
			config.value = { ...config.value, ...patch };
		},
		canvasWidth: CANVAS.width,
		canvasHeight: CANVAS.height,
		writable: leased,
		held,
	}));
	return {
		editor,
		writes,
		leased,
		held,
		document: () => config.value.layout,
		layer: itemId => ({ type: 'item', itemId }),
		composition: () => config.value.layout.composition,
		storeItems: (items) => {
			config.value = {
				...config.value,
				layout: {
					...config.value.layout,
					composition: { ...config.value.layout.composition, items },
				},
			};
		},
	};
}

/** Each host's column of the shared editor's test table. */
export const GRAPHICS_EDITOR_HOSTS: readonly GraphicsEditorHostFixture[] = [
	{
		name: 'Feature Match Overlay',
		hostId: 'feature-match-overlay',
		// One harness type for every host: the table only names layers through `layer`.
		editing: options => featureMatchLayoutEditing(options) as unknown as GraphicsEditorHarness,
	},
];
