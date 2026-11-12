<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { BroadcastGraphicsEditor, BroadcastGraphicsEditorLayer } from '~/modules/broadcast-graphics/editorHost';
import type { GraphicsEditorTree, GraphicsLayerListSection } from '~/modules/graphics/editor/host';
import { createBroadcastGraphic, deleteBroadcastGraphic, moveBroadcastGraphic } from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';
import { broadcastGraphicLayers } from '~/modules/broadcast-graphics/editorHost';

/**
 * The Broadcast Graphics editor's layer list: the shared one (#1100), with each
 * Broadcast Graphic of the Screen's stack as a top-level row and its Graphic Items
 * nested beneath it, front at the top.
 *
 * A graphic's row selects it, which is what the inspector's graphic panel and the
 * `?graphic=` address follow, and carries the host's playout mark. Its menu moves
 * it within the stack and deletes it; a graphic on air is not deleted, since its
 * Graphic Items are not edited either, and no move reorders the graphics on air. Adding a Broadcast Graphic selects it, once
 * the edit is admitted. Every stack edit is one undo step of the shared editor.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	editor: BroadcastGraphicsEditor;
	tree: GraphicsEditorTree<readonly BroadcastGraphicConfig[], BroadcastGraphicsEditorLayer>;
	/** The Broadcast Graphic selected itself, with no layer selected. */
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{
	/** A Broadcast Graphic is selected, or none with the canvas. */
	selectGraphic: [graphicId: string | null];
}>();

defineSlots<{
	/** A playout mark beside a Broadcast Graphic's name. */
	'graphic-badge'?: (props: { graphic: BroadcastGraphicConfig }) => unknown;
}>();

const writable = computed(() => props.editor.writable.value);

/** The stack front to back, one section per Broadcast Graphic. */
const sections = computed<GraphicsLayerListSection<BroadcastGraphicsEditorLayer>[]>(() =>
	[...props.graphics].reverse().map(graphic => ({
		key: graphic.id,
		title: graphic.name,
		layers: broadcastGraphicLayers(graphic),
		empty: 'No Graphic Items yet',
	})));

const graphicRowSelected = computed(() => props.editor.layers.value.length === 0 && props.selectedGraphicId !== null);

function graphicOf(graphicId: string) {
	return props.graphics.find(graphic => graphic.id === graphicId);
}

function selectGraphic(graphicId: string) {
	props.editor.select({ type: 'canvas' });
	emit('selectGraphic', graphicId);
}

function addGraphic() {
	const graphicId = randomUuid();
	if (props.editor.edit(createBroadcastGraphic(props.graphics, { id: graphicId }).graphics))
		selectGraphic(graphicId);
}

const hostAddItems = computed<DropdownMenuItem[]>(() => [
	{
		label: 'Broadcast Graphic',
		icon: 'i-lucide-layers',
		onSelect: addGraphic,
	},
]);

type GraphicMove = 1 | -1 | 'front' | 'back';

/** The stack with a Broadcast Graphic moved by one, or to an edge; null when it is already there. */
function movedStack(graphicId: string, to: GraphicMove): BroadcastGraphicConfig[] | null {
	const index = props.graphics.findIndex(graphic => graphic.id === graphicId);
	const target = to === 'front'
		? props.graphics.length - 1
		: to === 'back'
			? 0
			: index + to;
	return index < 0 || target === index || target < 0 || target >= props.graphics.length
		? null
		: moveBroadcastGraphic(props.graphics, graphicId, target - index);
}

function moveGraphic(graphicId: string, to: GraphicMove) {
	const moved = movedStack(graphicId, to);
	if (moved)
		props.editor.edit(moved);
}

function removeGraphic(graphicId: string) {
	if (props.editor.edit(deleteBroadcastGraphic(props.graphics, graphicId)))
		emit('selectGraphic', null);
}

/** A move's menu entry: not offered past an edge, or where it would reorder the graphics on air. */
function moveEntry(graphicId: string, to: GraphicMove, label: string, icon: string): DropdownMenuItem {
	const moved = movedStack(graphicId, to);
	const reordersOnAir = moved !== null && props.editor.changesForbidden(moved);
	return {
		label,
		icon,
		disabled: moved === null || reordersOnAir,
		description: reordersOnAir
			? 'Would reorder graphics on air'
			: undefined,
		onSelect: () => moveGraphic(graphicId, to),
	};
}

function graphicMenu(graphicId: string): DropdownMenuItem[][] {
	const graphic = graphicOf(graphicId);
	const onAir = graphic !== undefined && !props.editor.mayEditComposition(graphic);
	return [
		[
			moveEntry(graphicId, 1, 'Bring forward', 'i-lucide-arrow-up'),
			moveEntry(graphicId, -1, 'Send backward', 'i-lucide-arrow-down'),
			moveEntry(graphicId, 'front', 'Bring to front', 'i-lucide-bring-to-front'),
			moveEntry(graphicId, 'back', 'Send to back', 'i-lucide-send-to-back'),
		],
		[
			{
				label: 'Delete',
				icon: 'i-lucide-trash-2',
				color: 'error',
				disabled: onAir,
				description: onAir
					? 'On air: take it off air first'
					: undefined,
				onSelect: () => removeGraphic(graphicId),
			},
		],
	];
}
</script>

<template>
	<GraphicsLayerList
		:editor="editor"
		:tree="tree"
		:document="graphics"
		:sections="sections"
		:canvas-width="canvasWidth"
		:canvas-height="canvasHeight"
		:host-add-items="hostAddItems"
		:host-selected="graphicRowSelected"
		@select-canvas="emit('selectGraphic', null)"
	>
		<template #section="{ section }">
			<div
				class="mt-2 flex items-center gap-1 rounded-md border pr-1 transition"
				:class="graphicRowSelected && selectedGraphicId === section.key ? 'border-primary/60 bg-primary/10' : 'border-default/70 bg-muted/20 hover:bg-muted/40'"
				:data-graphic-id="section.key"
				data-testid="broadcast-graphic-row"
			>
				<button
					type="button"
					class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
					:aria-current="graphicRowSelected && selectedGraphicId === section.key ? 'true' : undefined"
					data-testid="broadcast-graphic-select"
					@click="selectGraphic(section.key)"
				>
					<UIcon name="i-lucide-layers" class="size-4 shrink-0 text-muted" />
					<span class="min-w-0 flex-1 truncate text-sm font-medium">{{ section.title }}</span>
				</button>
				<!--
					Host capability, not editor vocabulary: only a Broadcast Graphics host
					has playout state to mark on a graphic (#373).
				-->
				<slot v-if="graphicOf(section.key)" name="graphic-badge" :graphic="graphicOf(section.key)!" />
				<UDropdownMenu v-if="writable" :items="graphicMenu(section.key)" :content="{ align: 'end' }">
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						icon="i-lucide-ellipsis"
						:aria-label="`More actions for ${section.title}`"
						data-testid="broadcast-graphic-more"
					/>
				</UDropdownMenu>
			</div>
		</template>
	</GraphicsLayerList>
</template>
