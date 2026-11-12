<script setup lang="ts">
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

/**
 * The Talent Screen's settings: the generic renderer (#1094), with the Talent
 * lineup, which no plain control edits, in its `talent-lineup` slot.
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
		<template #talent-lineup="{ config, update }">
			<ScreenModesTalentLineup
				:talent-ids="config.talentIds"
				@update="update({ talentIds: $event })"
			/>
		</template>
	</ScreenModeSettings>
</template>
