<script setup lang="ts">
import { THEME_COLOR_SOURCE_ITEMS } from '~/modules/theme-editor/themeColor';

// A colour inside a composite token (#829): it follows a colour Foundation
// Token, or holds its own colour. `value` is the encoded colour the shared
// graphics fields pass their colour slot (`encodeThemeColor`).

const props = defineProps<{
	value: string;
	label: string;
	disabled?: boolean;
	testId?: string;
}>();

const emit = defineEmits<{ update: [value: string] }>();

const OWN = '__own__';
const SOURCE_ITEMS = [
	...THEME_COLOR_SOURCE_ITEMS,
	{ label: 'Own colour', value: OWN },
];

const follows = computed(() => THEME_COLOR_SOURCE_ITEMS.some(item => item.value === props.value));

function chooseSource(source: string) {
	if (source === OWN) {
		if (follows.value)
			emit('update', '#ffffff');
		return;
	}
	if (source !== props.value)
		emit('update', source);
}
</script>

<template>
	<div class="flex flex-wrap items-center gap-2" :data-testid="testId">
		<USelect
			:model-value="follows ? value : OWN"
			:items="SOURCE_ITEMS"
			size="xs"
			class="w-44"
			:disabled="disabled"
			:aria-label="`${label} source`"
			data-token-part="colour-source"
			@update:model-value="chooseSource"
		/>
		<UIColorPicker
			v-if="!follows"
			:model-value="value"
			size="xs"
			:disabled="disabled"
			:aria-label="label"
			data-token-part="colour"
			@update:model-value="color => color && emit('update', String(color))"
		/>
	</div>
</template>
