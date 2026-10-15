<script setup lang="ts">
import type { GraphicApplicationFontId } from '~~/shared/modules/graphics';
import { GRAPHIC_FONT_OPTIONS } from '~~/shared/modules/graphics';

/**
 * The font control of a typography Graphic Style Set Entry: an application font and
 * nothing else, because a Graphic Style Set references application fonts only
 * (ADR-0001). A Graphic Item's typography, which may also pin a library font, uses
 * `FontSelectionField` instead.
 */
defineProps<{
	fontId: GraphicApplicationFontId;
	size: 'sm' | 'xs';
	disabled?: boolean;
	testIdPrefix: string;
}>();

const emit = defineEmits<{
	'update:fontId': [fontId: GraphicApplicationFontId];
}>();
</script>

<template>
	<UFormField label="Font" :size="size">
		<USelect
			:model-value="fontId"
			:items="GRAPHIC_FONT_OPTIONS"
			value-key="value"
			size="sm"
			class="w-full"
			:disabled="disabled"
			:data-testid="`${testIdPrefix}-font`"
			@update:model-value="emit('update:fontId', $event as GraphicApplicationFontId)"
		/>
	</UFormField>
</template>
