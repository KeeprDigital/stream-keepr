<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Archetype picker of Screen settings, an Event Reference (ADR-0038): the
 * Event's Archetypes, searched by name since an Event can hold many. It loads
 * the Archetypes it lacks, re-reads them on Reconnect Resync (#610), and emits
 * the Archetype's id, or `null` when cleared.
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	eventId: number;
	label?: string;
	description?: string;
	nullLabel?: string;
}>(), {
	label: 'Archetype',
	nullLabel: 'Select an archetype…',
});

const emit = defineEmits<{
	'update:modelValue': [archetypeId: number | null];
}>();

const archetypeStore = useArchetypeStore();

const items = computed(() => archetypeStore.archetypes.map(archetype => ({ label: archetype.name, value: archetype.id })));

useConsumedEventData(['archetypes']);

onMounted(async () => {
	if (props.eventId && !archetypeStore.isLoaded)
		await archetypeStore.loadByEventId(props.eventId);
});
</script>

<template>
	<ScreenEventReferenceField
		:label="label"
		:description="description"
		:null-label="nullLabel"
		:model-value="modelValue"
		:items="items"
		searchable
		@update:model-value="emit('update:modelValue', $event)"
	/>
</template>
