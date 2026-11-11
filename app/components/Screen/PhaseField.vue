<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Phase picker of Screen settings, an Event Reference (ADR-0038): every
 * Phase of the Event in Phase order, since nothing marks one as a top cut
 * (#752). It loads the Phases it lacks, re-reads them on Reconnect Resync
 * (#610), and emits the Phase's id, or `null` for none.
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	eventId: number;
	label?: string;
	description?: string;
	nullLabel?: string;
}>(), {
	label: 'Phase',
	nullLabel: 'Select a phase…',
});

const emit = defineEmits<{
	'update:modelValue': [phaseId: number | null];
}>();

const phaseStore = usePhaseStore();

const items = computed(() => [...phaseStore.phases]
	.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
	.map(phase => ({ label: phase.name, value: phase.id })));

useConsumedEventData(['phases']);

onMounted(async () => {
	if (props.eventId && !phaseStore.isLoaded)
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
