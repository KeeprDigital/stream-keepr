<script setup lang="ts">
import type { ThemeDimensionBounds } from '~~/shared/modules/theme';

// A dimension token, in Event Canvas pixels, in the number field the graphics
// inspector shares: typed, stepped or dragged by its label, held within its
// bounds. A cleared field leaves the token as it is.

const props = defineProps<{
	modelValue: number;
	label: string;
	bounds?: ThemeDimensionBounds;
}>();

const emit = defineEmits<{
	commit: [value: number];
}>();

function update(value: number | null) {
	if (value === null || !Number.isFinite(value))
		return;
	const { min, max } = props.bounds ?? { min: 0, max: Number.POSITIVE_INFINITY };
	const bounded = Math.min(max, Math.max(min, value));
	if (bounded !== props.modelValue)
		emit('commit', bounded);
}
</script>

<template>
	<GraphicsNumberField
		label="Pixels"
		size="sm"
		class="w-32"
		:model-value="modelValue"
		:min="bounds?.min ?? 0"
		:max="bounds?.max"
		:aria-label="`${label} in pixels`"
		data-token-part="dimension"
		@update:model-value="update"
	/>
</template>
