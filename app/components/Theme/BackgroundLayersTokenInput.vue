<script setup lang="ts">
import type { BackgroundLayer } from '~~/shared/types/screenConfig';

// A Background Layer stack token, edited with the Screen's own stack editor.
// Its image and video layers take library media or a Remote Media URL; a Theme
// holds the library revisions as its own Graphic Asset References (ADR-0050).
// A colour layer holds a literal colour, as a Screen's own stack does.

defineProps<{
	/** The stack as it resolves: every colour a literal. */
	modelValue: BackgroundLayer[];
	label: string;
	/** The Event whose adopted assets the media picker offers first, if any. */
	eventId?: number;
}>();

const emit = defineEmits<{
	commit: [value: BackgroundLayer[]];
}>();
</script>

<template>
	<div data-token-part="background-layers" :aria-label="`${label} layers`" role="group">
		<ScreenBackgroundLayersEditor
			:layers="modelValue"
			:event-id="eventId"
			@update:layers="value => emit('commit', value)"
		>
			<template #color="{ value, update }">
				<ThemeColorField
					:value="value"
					:label="`${label} layer colour`"
					@update="update"
				/>
			</template>
		</ScreenBackgroundLayersEditor>
	</div>
</template>
