<script setup lang="ts">
import type { GraphicsHostContract } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	addGraphicItem,
	createBroadcastGraphic,
	deleteBroadcastGraphic,
	deleteGraphicItem,
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
 * The definition palette offers exactly the Graphic Item kinds the Host
 * Contract's declared context supports.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	contract: GraphicsHostContract;
	canvasWidth: number;
	canvasHeight: number;
	/**
	 * Whether this session may author the tree. A session observing an artifact
	 * another session's Graphics Authoring Lease covers still selects and reads it,
	 * but is offered no authoring control and emits no change.
	 */
	writable?: boolean;
}>();

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
}>();

/**
 * Fail closed: a caller that does not grant authoring gets a read-only editor.
 * Only a session confirmed to hold the artifact's Graphics Authoring Lease authors
 * it, so an absent prop must never read as permission.
 */
const canAuthor = computed(() => props.writable === true);

const itemKindOptions = computed(() => graphicItemDefinitionsForHost(props.contract).map(definition => ({
	label: definition.label,
	value: definition.kind,
	icon: definition.icon,
})));

const selectedGraphic = computed(() =>
	props.graphics.find(graphic => graphic.id === props.selectedGraphicId) ?? null,
);

function isSelected(target: GraphicsSelectionTarget) {
	return graphicsSelectionKey(props.selectedTarget) === graphicsSelectionKey(target);
}

function addGraphic() {
	if (!canAuthor.value)
		return;
	const { graphics, graphicId } = createBroadcastGraphic(props.graphics, { id: randomUuid() });
	emit('update:graphics', graphics);
	emit('update:selectedTarget', { type: 'graphic', graphicId });
}

function moveGraphic(graphicId: string, delta: 1 | -1) {
	if (!canAuthor.value)
		return;
	emit('update:graphics', moveBroadcastGraphic(props.graphics, graphicId, delta));
}

function removeGraphic(graphicId: string) {
	if (!canAuthor.value)
		return;
	emit('update:graphics', deleteBroadcastGraphic(props.graphics, graphicId));
	emit('update:selectedTarget', { type: 'canvas' });
}

function addItem(kind: GraphicItemKind) {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic)
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

function moveItem(itemId: string, delta: 1 | -1) {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic)
		return;
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, moveGraphicItem(graphic, itemId, delta)));
}

function removeItem(itemId: string) {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic)
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
				v-if="canAuthor"
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
					v-if="canAuthor"
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

			<UFormField v-if="canAuthor" label="Add Graphic Item" size="sm">
				<USelect
					:items="itemKindOptions"
					value-key="value"
					placeholder="Add item..."
					class="w-full"
					data-testid="graphic-item-palette"
					@update:model-value="addItem($event as GraphicItemKind)"
				/>
			</UFormField>

			<div class="space-y-1.5">
				<div v-for="(item, index) in selectedGraphic.items" :key="item.id" class="flex gap-1">
					<button
						type="button"
						class="flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-2 text-left transition"
						:class="isSelected({ type: 'item', graphicId: selectedGraphic.id, itemId: item.id }) ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/10 hover:bg-muted/30'"
						data-testid="graphic-item-node"
						@click="emit('update:selectedTarget', { type: 'item', graphicId: selectedGraphic.id, itemId: item.id })"
					>
						<UIcon :name="graphicItemIcon(item.type)" class="mt-0.5 size-4 shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="flex items-center gap-2">
								<span class="truncate text-sm font-medium">{{ item.label }}</span>
								<UBadge size="xs" variant="soft">{{ graphicItemKindLabel(item.type) }}</UBadge>
							</span>
							<span class="mt-0.5 block truncate text-xs text-muted">{{ graphicItemSummary(item) }}</span>
						</span>
						<UIcon :name="item.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'" class="mt-0.5 size-4 shrink-0 text-muted" />
					</button>
					<GraphicsCompositorReorderControls
						v-if="canAuthor"
						:label="item.label"
						:can-move-forward="index < selectedGraphic.items.length - 1"
						:can-move-backward="index > 0"
						@move="moveItem(item.id, $event)"
						@remove="removeItem(item.id)"
					/>
				</div>
			</div>
		</section>
	</div>
</template>
