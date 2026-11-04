<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const roundStore = useRoundStore();
const phaseStore = usePhaseStore();
const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'round-clock',
);

defineExpose({ resetConfig, saving });

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('round-clock').fields;

// Unset follows the Current Round from Round to Round (ADR-0066).
const roundOptions = computed(() => [
	{ label: 'Current Round', value: null },
	...roundPickerOptions(roundStore.rounds, phaseStore.phases),
]);

// What the picker below loads, re-read on Reconnect Resync (#610).
useConsumedEventData(['phases', 'rounds']);

onMounted(async () => {
	if (props.eventId && !roundStore.isLoaded)
		await roundStore.loadRoundsByEventId(props.eventId);
	if (props.eventId && !phaseStore.isLoaded)
		await phaseStore.loadPhasesByEventId(props.eventId);
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				label="Round"
				name="roundId"
				description="The Current Round follows the Event as Melee pairs each Round. Set a Round's start and duration on the Event Structure page."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.roundId ?? null"
					:items="roundOptions"
					class="w-64"
					@update:model-value="updateConfig({ roundId: $event ?? null })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Display">
			<ScreenSettingsToggle
				:label="fields.showRoundName.label"
				description="Show the Round's name above its clock."
				:model-value="config.showRoundName"
				@update:model-value="updateConfig({ showRoundName: $event })"
			/>
		</ScreenSettingsCard>
	</div>
</template>
