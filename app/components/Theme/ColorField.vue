<script setup lang="ts">
// A colour inside a composite token (#829): a plain picker over a literal
// colour. It updates once the picker closes, so a drag is one token write.

defineProps<{
	value: string;
	label: string;
	/** Edits its own colour's alpha; off where an opacity control sits beside it (#955 decision 4). */
	alpha?: boolean;
	disabled?: boolean;
	testId?: string;
}>();

const emit = defineEmits<{ update: [value: string] }>();
</script>

<template>
	<UIColorPicker
		:model-value="value"
		:alpha="alpha"
		commit="close"
		size="xs"
		:disabled="disabled"
		:aria-label="label"
		:data-testid="testId"
		data-token-part="colour"
		@update:model-value="color => color && emit('update', String(color))"
	/>
</template>
