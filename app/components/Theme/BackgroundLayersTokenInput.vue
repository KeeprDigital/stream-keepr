<script setup lang="ts">
import type { ThemeBackgroundLayer } from '~~/shared/modules/theme';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { useThemeTokenDraft } from '~/modules/theme-editor/draft';

// A Background Layer stack token, edited with the Screen's own stack editor.
// Its image and video layers take library media or a Remote Media URL; a Theme
// holds the library revisions as its own Graphic Asset References (ADR-0050).
// It edits the stack as it resolves now, so a colour layer naming a colour
// Foundation Token (#831) reads, and is written back, as its literal.

const props = defineProps<{
	modelValue: ThemeBackgroundLayer<string>[];
	label: string;
	/** The Event whose adopted assets the media picker offers first, if any. */
	eventId?: number;
}>();

const emit = defineEmits<{
	commit: [value: ThemeBackgroundLayer[]];
}>();

const { draft, edit } = useThemeTokenDraft(() => props.modelValue, value => emit('commit', value));

function editLayers(layers: BackgroundLayer[]) {
	edit(layers);
}
</script>

<template>
	<div data-token-part="background-layers" :aria-label="`${label} layers`" role="group">
		<ScreenBackgroundLayersEditor
			:layers="draft"
			:event-id="eventId"
			@update:layers="editLayers"
		/>
	</div>
</template>
