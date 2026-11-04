<script setup lang="ts">
// A colour token, which may be translucent or any CSS colour. It commits once,
// when the picker closes: each commit is a Theme or Screen write that reaches
// the outputs, so a drag writes nothing until it ends.

defineProps<{
	modelValue: string;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: string];
}>();
</script>

<template>
	<UIColorPicker
		:model-value="modelValue"
		alpha
		allow-raw-value
		commit="close"
		:aria-label="`${label} colour`"
		data-token-part="colour"
		@update:model-value="value => value && emit('commit', value)"
	/>
</template>
