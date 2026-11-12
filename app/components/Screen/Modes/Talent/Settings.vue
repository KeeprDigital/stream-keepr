<script setup lang="ts">
import type { Screen } from '~/types';
import { useModeSettingsRenderer } from '~/composables/screen/useModeSettingsRenderer';

/**
 * The Talent Screen's settings: the generic renderer (#1094), with the Talent
 * lineup, which no plain control edits, in its `talent-lineup` slot.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

defineExpose(useModeSettingsRenderer());
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #talent-lineup="{ config, update }">
			<ScreenModesTalentLineup
				:talent-ids="config.talentIds"
				@update="update({ talentIds: $event })"
			/>
		</template>
	</ScreenModeSettings>
</template>
