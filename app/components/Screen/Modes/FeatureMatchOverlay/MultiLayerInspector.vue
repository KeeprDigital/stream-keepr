<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import type { AlignEdge, DistributeAxis } from '~/modules/graphics/canvasAlignment';
import type { LayerGroupRefusal } from '~/modules/graphics/editor/layerGrouping';
import { editorSelectionLayer } from '~/modules/feature-match-overlay/editorSelection';
import { ALIGN_COMMANDS, DISTRIBUTE_COMMANDS } from '~/modules/graphics/editor/layerAlignment';
import { LAYER_GROUP_REFUSAL_REASONS } from '~/modules/graphics/editor/layerGrouping';

/**
 * The property panel with several layers selected (#740): how many, and
 * the geometry they share.
 *
 * Each field shows the value every selected layer has, or reads Mixed, and an
 * edit writes that value to all of them. Values are each layer's stored
 * top-left rectangle in pixels, as its own panel stores it: a group child's
 * position is within its group. Nothing kind-specific is offered, since the
 * selection can mix Source Items and Graphic Items of any kind.
 *
 * It is the one place that aligns the selection, to the bounds it covers, and
 * distributes it, which is offered at three or more (#1069).
 *
 * Group wraps the selection in a Graphic Group, as ⌘G does, and a selection it
 * cannot group says why beside the disabled control (#920).
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	layers: readonly FeatureMatchLayoutEditorLayer[];
	/** Whether this session holds the Graphics Authoring Lease; read-only otherwise (#738). */
	writable?: boolean;
	/** Why the selection cannot be grouped, or null when it can. */
	groupRefusal?: LayerGroupRefusal | null;
	/** Whether the selected layers have anything to line up. */
	canAlign?: boolean;
	/** Whether three or more of the selected layers distribute. */
	canDistribute?: boolean;
}>();

const emit = defineEmits<{
	update: [patch: Partial<GraphicRect>];
	group: [];
	align: [edge: AlignEdge];
	distribute: [axis: DistributeAxis];
}>();

const FIELDS = [
	{ axis: 'x', label: 'X' },
	{ axis: 'y', label: 'Y' },
	{ axis: 'width', label: 'W' },
	{ axis: 'height', label: 'H' },
] as const;

const rects = computed(() => props.layers.flatMap((layer) => {
	const rect = editorSelectionLayer(props.layout, layer);
	return rect
		? [rect]
		: [];
}));

/** The value every selected layer has on an axis, or nothing when they differ. */
function shared(axis: keyof GraphicRect): number | undefined {
	const values = new Set(rects.value.map(rect => rect[axis]));
	return values.size === 1
		? [...values][0]
		: undefined;
}

function update(axis: keyof GraphicRect, value: number | null | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value))
		return;
	const pixels = axis === 'width' || axis === 'height'
		? Math.max(1, Math.round(value))
		: Math.round(value);
	emit('update', { [axis]: pixels });
}
</script>

<template>
	<section class="min-w-0" data-testid="overlay-multi-layer-inspector">
		<div class="mb-3 flex min-w-0 items-start gap-3 border-b border-default/70 pb-3">
			<UIcon name="i-lucide-layers" class="mt-0.5 size-5 shrink-0 text-muted" />
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold" data-testid="multi-layer-count">
					{{ layers.length }} layers
				</p>
				<p class="mt-0.5 text-xs text-muted">
					Editing a field sets it on every selected layer.
				</p>
			</div>
		</div>

		<fieldset class="grid min-w-0 grid-cols-2 gap-2" :disabled="writable !== true">
			<!-- A Mixed field has no one value to drag from, so only its input edits it. -->
			<GraphicsNumberField
				v-for="field in FIELDS"
				:key="field.axis"
				:label="field.label"
				size="sm"
				:model-value="shared(field.axis)"
				:placeholder="shared(field.axis) === undefined ? 'Mixed' : undefined"
				:min="field.axis === 'width' || field.axis === 'height' ? 1 : undefined"
				:aria-label="`${field.label} of every selected layer`"
				:data-testid="`multi-layer-${field.axis}`"
				@update:model-value="update(field.axis, $event)"
			/>
		</fieldset>

		<div
			class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1"
			role="toolbar"
			aria-label="Align and distribute"
			data-testid="multi-layer-align"
		>
			<div class="flex items-center">
				<UButton
					v-for="command in ALIGN_COMMANDS"
					:key="command.edge"
					size="xs"
					variant="ghost"
					color="neutral"
					:icon="command.icon"
					:disabled="writable !== true || !canAlign"
					:aria-label="`Align ${command.label.toLowerCase()}`"
					:title="`Align ${command.label.toLowerCase()} to the selection`"
					@click="emit('align', command.edge)"
				/>
			</div>
			<div v-if="layers.length >= 3" class="flex items-center">
				<UButton
					v-for="command in DISTRIBUTE_COMMANDS"
					:key="command.axis"
					size="xs"
					variant="ghost"
					color="neutral"
					:icon="command.icon"
					:disabled="writable !== true || !canDistribute"
					:aria-label="`Distribute ${command.label.toLowerCase()}`"
					:title="`Distribute ${command.label.toLowerCase()}`"
					@click="emit('distribute', command.axis)"
				/>
			</div>
		</div>

		<div class="mt-3 border-t border-default/70 pt-3">
			<UButton
				label="Group"
				icon="i-lucide-group"
				size="sm"
				color="neutral"
				variant="outline"
				:disabled="writable !== true || !!groupRefusal"
				aria-keyshortcuts="Meta+G"
				data-testid="multi-layer-group"
				@click="emit('group')"
			/>
			<p
				v-if="groupRefusal"
				class="mt-1.5 text-xs text-muted"
				data-testid="multi-layer-group-refusal"
			>
				{{ LAYER_GROUP_REFUSAL_REASONS[groupRefusal] }}
			</p>
		</div>
	</section>
</template>
