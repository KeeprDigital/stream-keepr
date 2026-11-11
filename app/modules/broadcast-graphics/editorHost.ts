import type { MaybeRefOrGetter } from 'vue';
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { GraphicsEditorHostContract, GraphicsEditorTree } from '~/modules/graphics/editor/host';
import { toValue } from 'vue';
import { BROADCAST_GRAPHICS_HOST_CONTRACT } from '~~/shared/modules/graphics';
import { copyGraphicLayers, pasteBroadcastGraphicLayers } from '~/modules/graphics/clipboard';

/**
 * The Broadcast Graphics half of the shared graphics editor's Host Contract.
 *
 * The document is the Screen's authored stack of Broadcast Graphics, back to
 * front. Each Broadcast Graphic is one composition, and its Graphic Items are the
 * editor's layers; a Broadcast Graphic itself is not a layer, since it has no box
 * on the canvas. The layer list shows each one as a top-level row with its items
 * nested, front at the top.
 *
 * Several layers selected all sit in one Broadcast Graphic, so align, group and
 * paste always act within one. A new or pasted item joins the graphic of the
 * selection, or, with no layer selected, the Broadcast Graphic the host has
 * selected.
 *
 * A Broadcast Graphic on air may not be written (#1100): an edit to it would reach
 * program at once. The editor refuses every write to it, and undo leaves it as it
 * is. While playout cannot be known, every graphic may be on air.
 *
 * Undo covers the item tree only. A Broadcast Graphic's Graphic Channel is set
 * beside the stack, outside undo, so a restored stack keeps each graphic's channel
 * as it is now.
 */

/** One Graphic Item of one Broadcast Graphic; item ids are unique per graphic only. */
export interface BroadcastGraphicsEditorLayer {
	type: 'item';
	graphicId: string;
	itemId: string;
}

type Stack = readonly BroadcastGraphicConfig[];
type Layer = BroadcastGraphicsEditorLayer;

export type BroadcastGraphicsEditor = GraphicsEditor<Stack, Layer>;

export function broadcastGraphicsEditorLayerKey(layer: Layer): string {
	return `item:${layer.graphicId}:${layer.itemId}`;
}

/** Each Broadcast Graphic's layers, front to back, its group's children beneath each group. */
export function broadcastGraphicLayers(graphic: BroadcastGraphicConfig): Layer[] {
	const layer = (itemId: string): Layer => ({ type: 'item', graphicId: graphic.id, itemId });
	return [...graphic.items].reverse().flatMap(item => [
		layer(item.id),
		...(item.type === 'group'
			? [...item.children].reverse().map(child => layer(child.id))
			: []),
	]);
}

function graphicOf(graphics: Stack, graphicId: string | null | undefined): BroadcastGraphicConfig | undefined {
	return graphicId == null
		? undefined
		: graphics.find(graphic => graphic.id === graphicId);
}

/**
 * Replace a Broadcast Graphic by id, or put it at the front when the stack no
 * longer has it, as an undo that leaves an on-air graphic in place must.
 */
function withGraphic(graphics: Stack, graphic: BroadcastGraphicConfig): BroadcastGraphicConfig[] {
	return graphics.some(entry => entry.id === graphic.id)
		? graphics.map(entry => entry.id === graphic.id
				? graphic
				: entry)
		: [...graphics, graphic];
}

/** Why a Social Profile Projection's Presentation Group is not removed alone. */
export const PRESENTATION_GROUP_REMOVAL = 'To remove this group, delete the projection and Presentation Group together in the inspector.';

/** The tree, given the Broadcast Graphic the host has selected when no layer is. */
export function broadcastGraphicsEditorTree(selectedGraphicId: () => string | null): GraphicsEditorTree<Stack, Layer> {
	function destination(graphics: Stack, selected: readonly Layer[]): BroadcastGraphicConfig | null {
		return graphicOf(graphics, selected[0]?.graphicId ?? selectedGraphicId()) ?? null;
	}

	return {
		host: BROADCAST_GRAPHICS_HOST_CONTRACT,
		key: broadcastGraphicsEditorLayerKey,
		order: graphics => [...graphics].reverse().flatMap(broadcastGraphicLayers),
		compositions: graphics => graphics,
		item: (graphics, layer) => {
			const composition = graphicOf(graphics, layer.graphicId);
			return composition
				? { composition, itemId: layer.itemId }
				: null;
		},
		itemLayer: (composition, itemId) => ({ type: 'item', graphicId: composition.id, itemId }),
		destination,
		withComposition: withGraphic,
		// A projection reads its Presentation Group, so the two go together or not at all.
		removal: (graphics, layer) => graphicOf(graphics, layer.graphicId)?.socialProfileProjections
			?.some(projection => projection.presentationGroupId === layer.itemId)
			? PRESENTATION_GROUP_REMOVAL
			: null,
		// A layer snaps to the items of its own Broadcast Graphic: the others may never share program with it.
		canvasLayers: (graphics, layer) => graphicOf(graphics, layer.graphicId)?.items ?? [],
		copy: (graphics, layers) => {
			const composition = graphicOf(graphics, layers[0]?.graphicId);
			return composition
				? copyGraphicLayers('broadcast-graphics', { composition }, layers
						.filter(layer => layer.graphicId === composition.id)
						.map(layer => ({ type: 'item', itemId: layer.itemId })))
				: null;
		},
		paste: (copied, graphics, into) => {
			const composition = destination(graphics, into.selected);
			const outcome = pasteBroadcastGraphicLayers(copied, { graphics, graphicId: composition?.id ?? '' }, {
				groupId: into.groupId,
				nextId: into.nextId,
			});
			return outcome.ok
				? {
						ok: true,
						document: outcome.graphics,
						pasted: outcome.pasted.map(itemId => ({ type: 'item', graphicId: composition!.id, itemId })),
					}
				: outcome;
		},
	};
}

export interface BroadcastGraphicsEditorHostOptions {
	graphics: () => Stack;
	/** The Screen's Graphic Channels, so a restored graphic never names one since deleted. */
	channels: () => readonly GraphicChannelConfig[];
	write: (graphics: BroadcastGraphicConfig[]) => void;
	/** The Broadcast Graphic selected while no layer is: where a new item goes. */
	selectedGraphicId: () => string | null;
	canvasWidth: MaybeRefOrGetter<number>;
	canvasHeight: MaybeRefOrGetter<number>;
	/** Whether this session holds the Screen's Graphics Authoring Lease. */
	writable: MaybeRefOrGetter<boolean>;
	/** Whether a Broadcast Graphic Template placement is in flight. */
	held?: MaybeRefOrGetter<boolean>;
	/** Whether a Broadcast Graphic may be on a program output now. */
	onAir: (graphicId: string) => boolean;
}

/** A restored stack, each graphic in the Graphic Channel it is in now, or its own while that channel still exists. */
function keepChannels(restored: Stack, current: Stack, channels: readonly GraphicChannelConfig[]): BroadcastGraphicConfig[] {
	return restored.map((graphic) => {
		const now = graphicOf(current, graphic.id);
		const channelId = now
			? now.channelId
			: channels.some(channel => channel.id === graphic.channelId)
				? graphic.channelId
				: undefined;
		if (channelId === graphic.channelId)
			return graphic;
		const { channelId: _, ...rest } = graphic;
		return channelId === undefined
			? rest
			: { ...rest, channelId };
	});
}

export function broadcastGraphicsEditorHost(options: BroadcastGraphicsEditorHostOptions): GraphicsEditorHostContract<Stack, Layer> {
	return {
		tree: broadcastGraphicsEditorTree(options.selectedGraphicId),
		document: {
			read: options.graphics,
			write: graphics => options.write([...graphics]),
			restore: (restored, current) => keepChannels(restored, current, options.channels()),
		},
		forbidden: {
			writable: () => toValue(options.writable),
			held: () => toValue(options.held) ?? false,
			composition: composition => options.onAir(composition.id),
		},
		canvas: () => ({
			width: toValue(options.canvasWidth),
			height: toValue(options.canvasHeight),
		}),
	};
}
