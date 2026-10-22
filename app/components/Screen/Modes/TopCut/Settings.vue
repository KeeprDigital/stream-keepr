<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'top-cut',
);

defineExpose({ resetConfig, saving });

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('top-cut').fields;

const phaseStore = usePhaseStore();

// What the picker below loads, re-read on Reconnect Resync (#610).
useConsumedEventData(['phases']);

onMounted(async () => {
	if (props.eventId && !phaseStore.isLoaded)
		await phaseStore.loadPhasesByEventId(props.eventId);
});

// Nothing marks a Phase as a top cut, so every Phase of the Event is offered (#752).
const phaseOptions = computed(() => [
	{ label: 'Select a phase…', value: null },
	...[...phaseStore.phases]
		.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
		.map(phase => ({ label: phase.name, value: phase.id })),
]);
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				label="Phase"
				description="The bracket shows this Phase's Rounds in order; its first Round sets the bracket's size."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.phaseId ?? null"
					:items="phaseOptions"
					class="w-64"
					@update:model-value="updateConfig({ phaseId: $event ?? null })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show a title above the bracket."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for the Phase's name."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInput
					:model-value="config.headerText ?? ''"
					placeholder="Auto"
					class="w-64"
					@update:model-value="updateConfig({ headerText: $event || null })"
				/>
			</UFormField>
		</ScreenSettingsCard>
	</div>
</template>
