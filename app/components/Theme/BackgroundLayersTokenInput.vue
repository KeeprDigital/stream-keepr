<script setup lang="ts">
import type { ThemeBackgroundLayer } from '~~/shared/modules/theme';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { useThemeTokenDraft } from '~/modules/theme-editor/draft';

// A Background Layer stack token, edited with the Screen's own stack editor.
// Its image and video layers take a Remote Media URL only until #828, so the
// editor is given no Event to pick library media from.

const props = defineProps<{
	modelValue: ThemeBackgroundLayer[];
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: ThemeBackgroundLayer[]];
}>();

const { draft, edit } = useThemeTokenDraft(() => props.modelValue, value => emit('commit', value));

function editLayers(layers: BackgroundLayer[]) {
	// The editor offers no library source without an Event, so every layer it emits is a Theme's.
	edit(layers as ThemeBackgroundLayer[]);
}
</script>

<template>
	<div data-token-part="background-layers" :aria-label="`${label} layers`" role="group">
		<ScreenBackgroundLayersEditor
			:layers="draft"
			@update:layers="editLayers"
		/>
	</div>
</template>
