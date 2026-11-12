<script setup lang="ts">
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

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

const renderer = useTemplateRef<ModeSettingsExposed>('renderer');

defineExpose(passOnRendererExposed(renderer));
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
