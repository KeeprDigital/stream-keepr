import type { Ref } from 'vue';
import type { BroadcastGraphicConfig, GraphicChannelConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { BroadcastGraphicsEditorLayer } from '~/modules/broadcast-graphics/editorHost';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import type { GraphicsClipboardHost } from '~/modules/graphics/clipboard';
import type { GraphicsEditorLayer } from '~/modules/graphics/editor/host';
import { ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { text } from '~~/test/helpers/graphicsComposition';
import { useGraphicsEditor } from '~/composables/useGraphicsEditor';
import { broadcastGraphicsEditorHost } from '~/modules/broadcast-graphics/editorHost';
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
			config.value = {
				...config.value,
				...patch,
			};
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

/** The Broadcast Graphic a Broadcast Graphics case edits, and one behind it that it leaves alone. */
export const EDITED_GRAPHIC_ID = 'lower-third';
export const OTHER_GRAPHIC_ID = 'slate';

/**
 * A Broadcast Graphics editor over a stack of two: `slate` at the back, holding one
 * text item `s`, and `lower-third` in front with `items` as its Graphic Items.
 * `onAir` names the graphics on a program output, and `channels` the Screen's
 * Graphic Channels.
 */
export function broadcastGraphicsEditing(options: { writable: boolean; items?: GraphicItemConfig[] }) {
	const graphics = ref<BroadcastGraphicConfig[]>([
		{
			id: OTHER_GRAPHIC_ID,
			name: 'Slate',
			items: [
				text('s', { x: 40, y: 40 }),
			],
		},
		{
			id: EDITED_GRAPHIC_ID,
			name: 'Lower Third',
			items: structuredClone(options.items ?? []),
		},
	]);
	const channels = ref<GraphicChannelConfig[]>([]);
	const writes: BroadcastGraphicConfig[][] = [];
	const leased = ref(options.writable);
	const held = ref(false);
	const onAir = ref(new Set<string>());
	const selectedGraphicId = ref<string | null>(EDITED_GRAPHIC_ID);
	const host = broadcastGraphicsEditorHost({
		graphics: () => graphics.value,
		channels: () => channels.value,
		write: (next) => {
			writes.push(next);
			graphics.value = next;
		},
		selectedGraphicId: () => selectedGraphicId.value,
		canvasWidth: CANVAS.width,
		canvasHeight: CANVAS.height,
		writable: leased,
		held,
		onAir: graphicId => onAir.value.has(graphicId),
	});
	const editor = useGraphicsEditor(host);
	const graphic = (id: string) => graphics.value.find(entry => entry.id === id)!;
	const harness: GraphicsEditorHarness<readonly BroadcastGraphicConfig[], BroadcastGraphicsEditorLayer> = {
		editor,
		writes,
		leased,
		held,
		document: () => graphics.value,
		layer: itemId => ({ type: 'item', graphicId: EDITED_GRAPHIC_ID, itemId }),
		composition: () => graphic(EDITED_GRAPHIC_ID),
		storeItems: (items) => {
			graphics.value = graphics.value.map(entry => entry.id === EDITED_GRAPHIC_ID
				? { ...entry, items }
				: entry);
		},
	};
	return {
		...harness,
		tree: host.tree,
		graphics,
		channels,
		onAir,
		selectedGraphicId,
		graphic,
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
	{
		name: 'Broadcast Graphics',
		hostId: 'broadcast-graphics',
		editing: options => broadcastGraphicsEditing(options) as unknown as GraphicsEditorHarness,
	},
];
