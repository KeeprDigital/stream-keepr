<script setup lang="ts">
import type { ThemeBackgroundLayer } from '~~/shared/modules/theme';
import { decodeThemeBackground, encodeThemeBackground } from '~/modules/theme-editor/themeColor';

// A Background Layer stack token, edited with the Screen's own stack editor.
// Its image and video layers take library media or a Remote Media URL; a Theme
// holds the library revisions as its own Graphic Asset References (ADR-0050).
// A colour layer follows a colour Foundation Token or holds its own colour, as
// a composite's colour does (#831, #851).

const props = defineProps<{
	modelValue: ThemeBackgroundLayer[];
	label: string;
	/** The Event whose adopted assets the media picker offers first, if any. */
	eventId?: number;
}>();

const emit = defineEmits<{
	commit: [value: ThemeBackgroundLayer[]];
}>();

const layers = computed(() => encodeThemeBackground(props.modelValue));
</script>

<template>
	<div data-token-part="background-layers" :aria-label="`${label} layers`" role="group">
		<ScreenBackgroundLayersEditor
			:layers="layers"
			:event-id="eventId"
			@update:layers="value => emit('commit', decodeThemeBackground(value))"
		>
			<template #color="{ value, update }">
				<ThemeColorSourceField
					:value="value"
					:label="`${label} layer colour`"
					@update="update"
				/>
			</template>
		</ScreenBackgroundLayersEditor>
	</div>
</template>
