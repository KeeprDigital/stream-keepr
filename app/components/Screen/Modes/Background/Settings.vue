<script setup lang="ts">
import type { Screen } from '~/types';

/**
 * The Background Screen's settings: the generic renderer (#1094), with its
 * Background Layer stack in the `background-layers` slot of Background &
 * Placement: the Theme's background while the Screen holds none, with
 * Customise for this Screen and Reset to Theme (`ScreenBackgroundSource`).
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<{ resetConfig: () => void; saving: boolean }>('renderer');

defineExpose({
	resetConfig: () => renderer.value?.resetConfig(),
	saving: computed(() => renderer.value?.saving ?? false),
});
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #background-layers="{ config, update }">
			<ScreenBackgroundSource
				:layers="config.layers ?? []"
				:event-id="eventId"
				@update:layers="update({ layers: $event })"
			/>
		</template>
	</ScreenModeSettings>
</template>
