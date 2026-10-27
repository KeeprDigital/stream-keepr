<script setup lang="ts">
import type { ThemeAlignment } from '~~/shared/modules/theme';
import { HORIZONTAL_ALIGN_SELECT_OPTIONS, VERTICAL_ALIGN_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';

// An alignment token: where a Screen host places its mode's content in the
// Event Canvas, on each axis. Each pick commits the whole value.

const props = defineProps<{
	modelValue: ThemeAlignment;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: ThemeAlignment];
}>();

function commit(edit: Partial<ThemeAlignment>) {
	const value = {
		...props.modelValue,
		...edit,
	};
	if (value.horizontal !== props.modelValue.horizontal || value.vertical !== props.modelValue.vertical)
		emit('commit', value);
}
</script>

<template>
	<div class="flex items-center gap-2">
		<USelect
			:model-value="modelValue.horizontal"
			:items="HORIZONTAL_ALIGN_SELECT_OPTIONS"
			size="sm"
			class="w-28"
			:aria-label="`${label} horizontally`"
			data-token-part="horizontal"
			@update:model-value="commit({ horizontal: $event })"
		/>
		<USelect
			:model-value="modelValue.vertical"
			:items="VERTICAL_ALIGN_SELECT_OPTIONS"
			size="sm"
			class="w-28"
			:aria-label="`${label} vertically`"
			data-token-part="vertical"
			@update:model-value="commit({ vertical: $event })"
		/>
	</div>
</template>
