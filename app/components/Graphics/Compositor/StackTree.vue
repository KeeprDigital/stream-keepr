<script setup lang="ts">
import type { GraphicsHostContract } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig, GraphicItemConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	addGraphicGroupChild,
	addGraphicItem,
	createBroadcastGraphic,
	deleteBroadcastGraphic,
	deleteGraphicItem,
	findGraphicItem,
	graphicGroupChildDefinitionsForHost,
	graphicItemDefinitionsForHost,
	graphicItemIcon,
	graphicItemKindLabel,
	graphicItemSummary,
	moveBroadcastGraphic,
	moveGraphicItem,
	replaceBroadcastGraphic,
} from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';
import { graphicsSelectionKey } from '~/modules/graphics/selection';
import GraphicsCompositorReorderControls from './ReorderControls.vue';

/**
 * The compositor's authoring tree: the Screen's back-to-front stack of
 * Broadcast Graphics and, within the selected graphic, its Graphic Layer Order.
 * A Graphic Group appears as one layer among its siblings with its own children
 * nested beneath it, which is exactly how it composites.
 *
 * The definition palette offers exactly the Graphic Item kinds the Host
 * Contract's declared context supports, and a Graphic Group's own palette omits
 * Graphic Group because groups do not nest.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	contract: GraphicsHostContract;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
}>();

function paletteOptions(definitions: readonly { label: string; kind: GraphicItemKind; icon: string }[]) {
	return definitions.map(definition => ({
		label: definition.label,
		value: definition.kind,
		icon: definition.icon,
	}));
}

const itemKindOptions = computed(() => paletteOptions(graphicItemDefinitionsForHost(props.contract)));
const groupChildKindOptions = computed(() => paletteOptions(graphicGroupChildDefinitionsForHost(props.contract)));

const selectedGraphic = computed(() =>
	props.graphics.find(graphic => graphic.id === props.selectedGraphicId) ?? null,
);

/** The Graphic Group the current selection sits in or is, if any. */
const selectedGroup = computed(() => {
	const graphic = selectedGraphic.value;
	if (!graphic || props.selectedTarget.type !== 'item')
		return null;
	const location = findGraphicItem(graphic, props.selectedTarget.itemId);
	if (location?.group)
		return location.group;
	return location?.item.type === 'group' ? location.item : null;
});

interface TreeRow {
	item: GraphicItemConfig;
	depth: number;
	index: number;
	siblingCount: number;
}

/** One flat list of rows, each knowing its own sibling list for reordering. */
const itemRows = computed<TreeRow[]>(() => (selectedGraphic.value?.items ?? []).flatMap((item, index, items) => {
	const row: TreeRow = { item, depth: 0, index, siblingCount: items.length };
	if (item.type !== 'group')
		return [row];

	return [
		row,
		...item.children.map((child, childIndex) => ({
			item: child as GraphicItemConfig,
			depth: 1,
			index: childIndex,
			siblingCount: item.children.length,
		})),
	];
}));

function isSelected(target: GraphicsSelectionTarget) {
	return graphicsSelectionKey(props.selectedTarget) === graphicsSelectionKey(target);
}

function addGraphic() {
	const { graphics, graphicId } = createBroadcastGraphic(props.graphics, { id: randomUuid() });
	emit('update:graphics', graphics);
	emit('update:selectedTarget', { type: 'graphic', graphicId });
}

function moveGraphic(graphicId: string, delta: 1 | -1) {
	emit('update:graphics', moveBroadcastGraphic(props.graphics, graphicId, delta));
}

function removeGraphic(graphicId: string) {
	emit('update:graphics', deleteBroadcastGraphic(props.graphics, graphicId));
	emit('update:selectedTarget', { type: 'canvas' });
}

function addItem(kind: GraphicItemKind) {
	const graphic = selectedGraphic.value;
	if (!graphic)
		return;

	const { graphic: updated, itemId } = addGraphicItem(graphic, {
		kind,
		id: randomUuid(),
		canvasWidth: props.canvasWidth,
		canvasHeight: props.canvasHeight,
	});
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, updated));
	emit('update:selectedTarget', { type: 'item', graphicId: graphic.id, itemId });
}

function addChild(kind: GraphicItemKind) {
	const graphic = selectedGraphic.value;
	const group = selectedGroup.value;
	if (!graphic || !group || kind === 'group')
		return;

	const { graphic: updated, itemId } = addGraphicGroupChild(graphic, {
		kind,
		groupId: group.id,
		id: randomUuid(),
		canvasWidth: props.canvasWidth,
		canvasHeight: props.canvasHeight,
	});
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, updated));
	emit('update:selectedTarget', { type: 'item', graphicId: graphic.id, itemId });
}

function moveItem(itemId: string, delta: 1 | -1) {
	const graphic = selectedGraphic.value;
	if (!graphic)
		return;
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, moveGraphicItem(graphic, itemId, delta)));
}

function removeItem(itemId: string) {
	const graphic = selectedGraphic.value;
	if (!graphic)
		return;
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, deleteGraphicItem(graphic, itemId)));
	emit('update:selectedTarget', { type: 'graphic', graphicId: graphic.id });
}
</script>

<template>
	<div class="space-y-4">
		<section class="rounded-lg border border-default/70 bg-default p-3">
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="text-sm font-semibold">
						Screen stack
					</p>
					<p class="text-xs text-muted">
						Back to front
					</p>
				</div>
				<UBadge variant="soft">
					{{ graphics.length }} graphics
				</UBadge>
			</div>
			<UButton
				class="mt-3 w-full"
				size="sm"
				variant="soft"
				icon="i-lucide-plus"
				data-testid="add-broadcast-graphic"
				@click="addGraphic"
			>
				Add Broadcast Graphic
			</UButton>
		</section>

		<div class="space-y-1.5">
			<div v-for="(graphic, index) in graphics" :key="graphic.id" class="flex gap-1">
				<button
					type="button"
					class="flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-3 text-left transition"
					:class="isSelected({ type: 'graphic', graphicId: graphic.id }) ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/20 hover:bg-muted/40'"
					data-testid="broadcast-graphic-node"
					@click="emit('update:selectedTarget', { type: 'graphic', graphicId: graphic.id })"
				>
					<UIcon name="i-lucide-layers" class="mt-0.5 size-4 shrink-0 text-muted" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{{ graphic.name }}</span>
						<span class="mt-0.5 block truncate text-xs text-muted">{{ graphic.items.length }} items</span>
					</span>
				</button>
				<GraphicsCompositorReorderControls
					:label="graphic.name"
					:can-move-forward="index < graphics.length - 1"
					:can-move-backward="index > 0"
					@move="moveGraphic(graphic.id, $event)"
					@remove="removeGraphic(graphic.id)"
				/>
			</div>
		</div>

		<section v-if="selectedGraphic" class="space-y-3 rounded-lg border border-default/70 bg-default p-3">
			<div class="flex items-center justify-between gap-3">
				<p class="text-sm font-semibold">
					{{ selectedGraphic.name }} items
				</p>
				<UBadge variant="soft">
					{{ selectedGraphic.items.length }}
				</UBadge>
			</div>

			<UFormField label="Add Graphic Item" size="sm">
				<USelect
					:items="itemKindOptions"
					value-key="value"
					placeholder="Add item..."
					class="w-full"
					data-testid="graphic-item-palette"
					@update:model-value="addItem($event as GraphicItemKind)"
				/>
			</UFormField>

			<UFormField
				v-if="selectedGroup"
				:label="`Add to ${selectedGroup.label}`"
				size="sm"
			>
				<USelect
					:items="groupChildKindOptions"
					value-key="value"
					placeholder="Add to group..."
					class="w-full"
					data-testid="graphic-group-child-palette"
					@update:model-value="addChild($event as GraphicItemKind)"
				/>
			</UFormField>

			<div class="space-y-1.5">
				<div
					v-for="row in itemRows"
					:key="row.item.id"
					class="flex gap-1"
					:class="row.depth > 0 ? 'pl-4' : ''"
					:data-graphic-item-depth="row.depth"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-2 text-left transition"
						:class="isSelected({ type: 'item', graphicId: selectedGraphic.id, itemId: row.item.id }) ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/10 hover:bg-muted/30'"
						data-testid="graphic-item-node"
						@click="emit('update:selectedTarget', { type: 'item', graphicId: selectedGraphic.id, itemId: row.item.id })"
					>
						<UIcon :name="graphicItemIcon(row.item.type)" class="mt-0.5 size-4 shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="flex items-center gap-2">
								<span class="truncate text-sm font-medium">{{ row.item.label }}</span>
								<UBadge size="xs" variant="soft">{{ graphicItemKindLabel(row.item.type) }}</UBadge>
							</span>
							<span class="mt-0.5 block truncate text-xs text-muted">{{ graphicItemSummary(row.item) }}</span>
						</span>
						<UIcon :name="row.item.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'" class="mt-0.5 size-4 shrink-0 text-muted" />
					</button>
					<GraphicsCompositorReorderControls
						:label="row.item.label"
						:can-move-forward="row.index < row.siblingCount - 1"
						:can-move-backward="row.index > 0"
						@move="moveItem(row.item.id, $event)"
						@remove="removeItem(row.item.id)"
					/>
				</div>
			</div>
		</section>
	</div>
</template>
