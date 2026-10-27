<script setup lang="ts">
import type { ThemeDimensionBounds } from '~~/shared/modules/theme';

// A dimension token, in Event Canvas pixels, within its bounds. Commits when the
// field is left, so typing a number writes it once.

const props = defineProps<{
	modelValue: number;
	label: string;
	bounds?: ThemeDimensionBounds;
}>();

const emit = defineEmits<{
	commit: [value: number];
}>();

const typed = ref<number | null>(props.modelValue);
watch(() => props.modelValue, (value) => {
	typed.value = value;
});

function commit() {
	const value = typed.value;
	const { min, max } = props.bounds ?? { min: 0, max: Number.POSITIVE_INFINITY };
	if (value === null || !Number.isFinite(value) || value < min || value > max) {
		typed.value = props.modelValue;
		return;
	}
	if (value !== props.modelValue)
		emit('commit', value);
}
</script>

<template>
	<div class="flex items-center gap-2">
		<UInputNumber
			v-model="typed"
			size="sm"
			class="w-32"
			:min="bounds?.min"
			:max="bounds?.max"
			:aria-label="`${label} in pixels`"
			data-token-part="dimension"
			@blur="commit"
			@change="commit"
		/>
		<span class="text-xs text-muted">px</span>
	</div>
</template>
