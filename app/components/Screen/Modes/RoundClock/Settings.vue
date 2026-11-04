<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'round-clock',
);

defineExpose({ resetConfig, saving });

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('round-clock').fields;
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard id="round-clock:data" title="Data" :collapsible="false">
			<!-- Unset follows the Current Round from Round to Round (ADR-0066). -->
			<ScreenRoundField
				:model-value="config.roundId"
				null-label="Current Round"
				description="The Current Round follows the Event as Melee pairs each Round; set a Round's start and duration on the Event Structure page."
				:event-id="eventId"
				@update:model-value="updateConfig({ roundId: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard
			id="round-clock:round-name"
			title="Round Name"
			:summary="config.showRoundName ? 'Shown above the clock' : 'Hidden'"
		>
			<ScreenConfigField
				:field="fields.showRoundName"
				:model-value="config.showRoundName"
				description="Show the Round's name above its clock."
				@update:model-value="updateConfig({ showRoundName: $event === true })"
			/>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="round-name" />
		</ScreenSettingsCard>

		<ScreenSettingsCard
			id="round-clock:clock"
			title="Clock"
			summary="Surface, type and text before, during and after the Round"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="clock" />
		</ScreenSettingsCard>
	</div>
</template>
