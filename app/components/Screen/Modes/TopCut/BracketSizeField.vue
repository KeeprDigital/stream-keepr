<script setup lang="ts">
import type { TopCutBracketSize } from '~~/shared/modules/top-cut-bracket';
import type { SettingsPageField } from '~/modules/screen-mode/settingsPage';
import { TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { fieldDescription, fieldLabel } from '~/modules/screen-mode/settingsPage';

/**
 * A Top Cut Bracket's size: unset, its Phase's first Round sizes it; a size
 * set only enlarges it, showing the byes the best Seeds take (#906). Its
 * values are numbers, so it is no plain select; it emits the size, or `null`
 * to size from the first Round again.
 */
defineProps<{
	entry: SettingsPageField;
	modelValue: TopCutBracketSize | null | undefined;
}>();

const emit = defineEmits<{
	'update:modelValue': [size: TopCutBracketSize | null];
}>();

const sizeOptions = [
	{ label: 'From the first Round', value: null },
	...TOP_CUT_BRACKET_SIZES.map(size => ({ label: `Top ${size}`, value: size })),
];
</script>

<template>
	<ScreenSettingsField :label="fieldLabel(entry)" :description="fieldDescription(entry)">
		<USelect
			:model-value="modelValue ?? null"
			:items="sizeOptions"
			class="w-64"
			@update:model-value="emit('update:modelValue', $event ?? null)"
		/>
	</ScreenSettingsField>
</template>
