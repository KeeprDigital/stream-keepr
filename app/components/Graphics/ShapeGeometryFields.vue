<script setup lang="ts">
import type { ShapeGeometryPresetId } from '~~/shared/modules/graphics';
import type { ShapeCorner, ShapeCornerKey, ShapeGeometry } from '~~/shared/types/graphics';
import { SHAPE_GEOMETRY_PRESETS } from '~~/shared/modules/graphics';
import {
	MAX_SHAPE_GEOMETRY_PX,
	SHAPE_CORNER_KEYS,
	SHAPE_CORNER_TREATMENT_VALUES,
} from '~~/shared/types/graphics';

/**
 * The one Shape Geometry fields control, for a Graphic Item in the compositor
 * Inspector and for a Graphic Style Set's Shape Geometry entry.
 *
 * Corners, slants, and presets: each corner's treatment, its size only while it
 * is not square, and each edge's slant, all in canvas pixels and bounded by what
 * a saved Shape Geometry accepts. An edit emits a patch: a whole corner, or one
 * slant.
 *
 * A preset is emitted by id rather than applied here, because what it produces
 * depends on bounds only the host knows — the item's own, a win box's, or none
 * at all for a Style Set entry — and a preset may also propose a height.
 *
 * `BorderRadiusControl` is not this: a Feature Match Overlay border radius has
 * neither cut corners nor slants.
 */
const props = withDefaults(defineProps<{
	geometry: ShapeGeometry;
	disabled?: boolean;
	size?: 'xs' | 'sm';
}>(), { size: 'sm' });

const emit = defineEmits<{
	update: [patch: Partial<ShapeGeometry>];
	preset: [presetId: ShapeGeometryPresetId];
}>();

const PRESET_OPTIONS = SHAPE_GEOMETRY_PRESETS.map(preset => ({
	label: preset.label,
	value: preset.id,
	icon: preset.icon,
}));
const TREATMENT_OPTIONS = SHAPE_CORNER_TREATMENT_VALUES.map(value => ({ label: value, value }));
const CORNER_LABELS: Record<ShapeCornerKey, string> = {
	topLeft: 'Top left',
	topRight: 'Top right',
	bottomRight: 'Bottom right',
	bottomLeft: 'Bottom left',
};
const SLANTS = [
	{ field: 'leftSlant', label: 'Left slant', ariaLabel: 'Left edge slant', testId: 'shape-left-slant' },
	{ field: 'rightSlant', label: 'Right slant', ariaLabel: 'Right edge slant', testId: 'shape-right-slant' },
] as const;

function updateCorner(corner: ShapeCornerKey, fields: Partial<ShapeCorner>) {
	emit('update', { [corner]: { ...props.geometry[corner], ...fields } });
}
</script>

<template>
	<div class="space-y-2">
		<UFormField label="Preset" :size="size">
			<USelect
				:items="PRESET_OPTIONS"
				value-key="value"
				placeholder="Apply preset..."
				:size="size"
				class="w-full"
				:disabled="disabled"
				data-testid="shape-geometry-preset"
				@update:model-value="emit('preset', $event as ShapeGeometryPresetId)"
			/>
		</UFormField>

		<div v-for="corner in SHAPE_CORNER_KEYS" :key="corner" class="grid grid-cols-2 gap-2">
			<UFormField :label="CORNER_LABELS[corner]" :size="size">
				<USelect
					:model-value="geometry[corner].treatment"
					:items="TREATMENT_OPTIONS"
					value-key="value"
					:size="size"
					class="w-full"
					:disabled="disabled"
					:data-testid="`shape-corner-${corner}`"
					@update:model-value="updateCorner(corner, { treatment: $event })"
				/>
			</UFormField>
			<UFormField v-if="geometry[corner].treatment !== 'square'" label="Size" :size="size">
				<UInputNumber
					:model-value="geometry[corner].size"
					:min="0"
					:max="MAX_SHAPE_GEOMETRY_PX"
					:size="size"
					class="w-full"
					:disabled="disabled"
					:aria-label="`${CORNER_LABELS[corner]} size`"
					@update:model-value="updateCorner(corner, { size: $event ?? 0 })"
				/>
			</UFormField>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<UFormField
				v-for="slant in SLANTS"
				:key="slant.field"
				:label="slant.label"
				:size="size"
			>
				<UInputNumber
					:model-value="geometry[slant.field]"
					:min="-MAX_SHAPE_GEOMETRY_PX"
					:max="MAX_SHAPE_GEOMETRY_PX"
					:size="size"
					class="w-full"
					:disabled="disabled"
					:data-testid="slant.testId"
					:aria-label="slant.ariaLabel"
					@update:model-value="emit('update', { [slant.field]: $event ?? 0 })"
				/>
			</UFormField>
		</div>
	</div>
</template>
