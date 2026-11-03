<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import { editorSelectionLayer } from '~/modules/feature-match-overlay/editorSelection';

/**
 * The property panel with several layers selected (#740): how many, and
 * the geometry they share.
 *
 * Each field shows the value every selected layer has, or reads Mixed, and an
 * edit writes that value to all of them. Values are each layer's stored
 * top-left rectangle in pixels, as its own panel stores it: a group child's
 * position is within its group. Nothing kind-specific is offered, since the
 * selection can mix Source Items and Graphic Items of any kind.
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	layers: readonly FeatureMatchLayoutEditorLayer[];
	/** Whether this session holds the Graphics Authoring Lease; read-only otherwise (#738). */
	writable?: boolean;
}>();

const emit = defineEmits<{
	update: [patch: Partial<GraphicRect>];
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
			<UFormField
				v-for="field in FIELDS"
				:key="field.axis"
				:label="field.label"
				size="sm"
			>
				<UInputNumber
					:model-value="shared(field.axis)"
					:placeholder="shared(field.axis) === undefined ? 'Mixed' : undefined"
					:min="field.axis === 'width' || field.axis === 'height' ? 1 : undefined"
					size="sm"
					class="w-full"
					:aria-label="`${field.label} of every selected layer`"
					:data-testid="`multi-layer-${field.axis}`"
					@update:model-value="update(field.axis, $event)"
				/>
			</UFormField>
		</fieldset>
	</section>
</template>
