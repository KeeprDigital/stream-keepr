<script setup lang="ts">
import type { Screen } from '~/types';
import { useModeSettingsRenderer } from '~/composables/screen/useModeSettingsRenderer';

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

defineExpose(useModeSettingsRenderer());
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
