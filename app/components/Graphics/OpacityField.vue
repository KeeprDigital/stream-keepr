<script setup lang="ts">
/**
 * The one opacity control, in the graphics inspector, the Theme editor and the
 * settings that share their fields: a `GraphicsNumberField` from 0 (clear) to 1
 * (opaque) in steps of 0.05, whose label drags it. A cleared field emits `null`;
 * what that means (fully opaque, fully clear, or unchanged) is the owner's to
 * decide. `class` lays out the field; aria-* and data-* land on the input.
 */
defineProps<{
	label: string;
	modelValue: number | null | undefined;
	size?: 'xs' | 'sm' | 'md';
	disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();
</script>

<template>
	<GraphicsNumberField
		:label="label"
		:model-value="modelValue"
		:min="0"
		:max="1"
		:step="0.05"
		:size="size ?? 'sm'"
		:disabled="disabled"
		@update:model-value="emit('update:modelValue', $event)"
	/>
</template>
