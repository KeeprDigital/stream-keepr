<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Round picker of Screen settings, an Event Reference (ADR-0038): the
 * Event's Rounds in Round order, named "Phase · Round" (#911), after a null
 * option whose label says what no Round means for the mode. It loads the
 * Rounds and Phases it lacks, re-reads them on Reconnect Resync (#610), and
 * emits the Round's id, or `null` for the null option.
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	eventId: number;
	label?: string;
	description?: string;
	/** What no Round means: "Current standings", "Select a round…". */
	nullLabel?: string;
}>(), {
	label: 'Round',
	nullLabel: 'Select a round…',
});

const emit = defineEmits<{
	'update:modelValue': [roundId: number | null];
}>();

const roundStore = useRoundStore();
const phaseStore = usePhaseStore();

const items = computed(() => roundPickerOptions(roundStore.rounds, phaseStore.phases));

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
	<ScreenEventReferenceField
		:label="label"
		:description="description"
		:null-label="nullLabel"
		:model-value="modelValue"
		:items="items"
		@update:model-value="emit('update:modelValue', $event)"
	/>
</template>
