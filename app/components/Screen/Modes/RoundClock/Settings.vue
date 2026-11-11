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

const clockSummary = computed(() => {
	if (!config.value.countUpAfterEnd)
		return 'Holds 0:00 after the Round';
	return config.value.countUpLimitMinutes == null
		? 'Counts up after the Round, without limit'
		: `Counts up after the Round, up to ${config.value.countUpLimitMinutes} min`;
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="round-clock:data" title="Source" :collapsible="false">
			<!-- Unset follows the Current Round from Round to Round (ADR-0066). -->
			<ScreenRoundField
				:model-value="config.roundId"
				null-label="Current Round"
				description="The Current Round follows the Event as Melee pairs each Round; set a Round's start and duration on the Event Structure page."
				:event-id="eventId"
				@update:model-value="updateConfig({ roundId: $event })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="round-clock:round-name"
			title="Round name"
			:summary="config.showRoundName ? 'Shown above the clock' : 'Hidden'"
		>
			<ScreenConfigField
				:field="fields.showRoundName"
				:model-value="config.showRoundName"
				description="Show the Round's name above its clock."
				@update:model-value="updateConfig({ showRoundName: $event === true })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="round-clock:clock"
			title="Clock"
			:summary="clockSummary"
		>
			<ScreenConfigField
				:field="fields.countUpAfterEnd"
				:model-value="config.countUpAfterEnd"
				description="When the Round ends, count up the time since the end instead of holding 0:00."
				@update:model-value="updateConfig({ countUpAfterEnd: $event === true })"
			/>
			<!-- Empty counts up without limit; a limit holds the clock there. -->
			<ScreenConfigField
				v-if="config.countUpAfterEnd"
				:field="fields.countUpLimitMinutes"
				:model-value="config.countUpLimitMinutes"
				description="Stop counting up after this many minutes and hold. Leave empty for no limit."
				placeholder="No limit"
				nullable
				@update:model-value="updateConfig({ countUpLimitMinutes: $event ?? null })"
			/>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="clock" />
		</ScreenSettingsSection>
	</div>
</template>
