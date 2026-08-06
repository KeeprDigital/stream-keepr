<script setup lang="ts">
import type { GraphicsHostContract } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig, GraphicItemConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	addGraphicGroupChild,
	addGraphicItem,
	authorsGraphicStack,
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
 *
 * ## A host that composes one composition has no stack
 *
 * The stack is the Broadcast Graphics host's, not the compositor's. A Feature
 * Match Overlay renders exactly one Feature Match Layout for exactly one Feature
 * Match Slot, so it declares `composition: 'single'` and this tree shows only that
 * composition's Graphic Layer Order — no stack section, no way to add, reorder, or
 * remove a member. It is still passed as a stack of one, because the render model
 * composes a stack and one is a stack.
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

/**
 * Whether the tree roots an author-editable stack at all.
 *
 * Read from the contract rather than inferred from `graphics.length`: a Broadcast
 * Graphics Screen with one Broadcast Graphic still authors a stack, and a length
 * of one must not silently take its stack controls away.
 */
const showStack = computed(() => authorsGraphicStack(props.contract));

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

/**
 * The stack mutators check the contract as well as the lease. Hiding a control is
 * a presentation decision; refusing to emit is what makes "this host has no stack"
 * a property of the component rather than of its current markup.
 */
function addGraphic() {
	if (!canAuthor.value || !showStack.value)
		return;
	const { graphics, graphicId } = createBroadcastGraphic(props.graphics, { id: randomUuid() });
	emit('update:graphics', graphics);
	emit('update:selectedTarget', { type: 'graphic', graphicId });
}

function moveGraphic(graphicId: string, delta: 1 | -1) {
	if (!canAuthor.value || !showStack.value)
		return;
	emit('update:graphics', moveBroadcastGraphic(props.graphics, graphicId, delta));
}

function removeGraphic(graphicId: string) {
	if (!canAuthor.value || !showStack.value)
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

function addChild(kind: GraphicItemKind) {
	const graphic = selectedGraphic.value;
	const group = selectedGroup.value;
	if (!canAuthor.value || !graphic || !group || kind === 'group')
		return;

	// A child is sized against its Graphic Group, not the Screen canvas, so this
	// deliberately passes no canvas dimensions.
	const { graphic: updated, itemId } = addGraphicGroupChild(graphic, {
		kind,
		groupId: group.id,
		id: randomUuid(),
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
		<section v-if="showStack" class="rounded-lg border border-default/70 bg-default p-3" data-testid="graphic-stack-section">
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

		<div v-if="showStack" class="space-y-1.5">
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

			<!--
				One button per kind, not a select. A select holds the kind it last
				added, so choosing that kind again is not a change and adds nothing —
				and the split lower-third an author is building needs four Shapes in a
				row (#234). A button has no value to hold: every press adds.
			-->
			<UFormField v-if="canAuthor" label="Add Graphic Item" size="sm">
				<div
					class="flex flex-wrap gap-1"
					role="group"
					aria-label="Add Graphic Item"
					data-testid="graphic-item-palette"
				>
					<UButton
						v-for="option in itemKindOptions"
						:key="option.value"
						size="xs"
						variant="soft"
						color="neutral"
						:icon="option.icon"
						:data-add-graphic-item-kind="option.value"
						@click="addItem(option.value)"
					>
						{{ option.label }}
					</UButton>
				</div>
			</UFormField>

			<UFormField
				v-if="canAuthor && selectedGroup"
				:label="`Add to ${selectedGroup.label}`"
				size="sm"
			>
				<div
					class="flex flex-wrap gap-1"
					role="group"
					:aria-label="`Add to ${selectedGroup.label}`"
					data-testid="graphic-group-child-palette"
				>
					<UButton
						v-for="option in groupChildKindOptions"
						:key="option.value"
						size="xs"
						variant="soft"
						color="neutral"
						:icon="option.icon"
						:data-add-graphic-group-child-kind="option.value"
						@click="addChild(option.value)"
					>
						{{ option.label }}
					</UButton>
				</div>
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
						v-if="canAuthor"
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
