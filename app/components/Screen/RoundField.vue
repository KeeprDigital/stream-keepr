<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Round picker of Screen settings, an Event Reference (ADR-0038): the
 * Event's Rounds in Round order, named "Phase · Round" (#911), after a null
 * option whose label says what no Round means for the mode. It loads the
 * Rounds and Phases it lacks, re-reads them on Reconnect Resync (#610), and
 * emits the Round's id, or `null` for the null option.
 */
const props = defineProps<{
	modelValue?: number | null;
	/** What no Round means: "Current standings", "Select a round…". */
	nullLabel: string;
	description: string;
	eventId: number;
}>();

const emit = defineEmits<{
	'update:modelValue': [roundId: number | null];
}>();

const roundStore = useRoundStore();
const phaseStore = usePhaseStore();

const options = computed(() => [
	{ label: props.nullLabel, value: null },
	...roundPickerOptions(roundStore.rounds, phaseStore.phases),
]);

useConsumedEventData(['phases', 'rounds']);

onMounted(async () => {
	if (!props.eventId)
		return;
	if (!roundStore.isLoaded)
		await roundStore.loadRoundsByEventId(props.eventId);
	if (!phaseStore.isLoaded)
		await phaseStore.loadPhasesByEventId(props.eventId);
});
</script>

<template>
	<ScreenSettingsField label="Round" :description="description">
		<USelect
			:model-value="modelValue ?? null"
			:items="options"
			class="w-64"
			@update:model-value="emit('update:modelValue', ($event as number | null | undefined) ?? null)"
		/>
	</ScreenSettingsField>
</template>
