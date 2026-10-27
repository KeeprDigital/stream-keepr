<script setup lang="ts">
import type { ShapeGeometryPresetId } from '~~/shared/modules/graphics';
import type { ShapeGeometry } from '~~/shared/types/graphics';
import { getShapeGeometryPreset } from '~~/shared/modules/graphics';

// A Shape Geometry token: corners and edge slants, as a Shape Graphic Item
// edits them. A preset sizes against a new Shape Graphic Item's bounds.

const props = defineProps<{
	modelValue: ShapeGeometry;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: ShapeGeometry];
}>();

const PRESET_BOUNDS = { width: 768, height: 108 };

function preset(id: ShapeGeometryPresetId) {
	emit('commit', getShapeGeometryPreset(id).apply(PRESET_BOUNDS).geometry);
}
</script>

<template>
	<GraphicsShapeGeometryFields
		:geometry="modelValue"
		size="xs"
		@update="patch => emit('commit', { ...props.modelValue, ...patch })"
		@preset="preset"
	/>
</template>
