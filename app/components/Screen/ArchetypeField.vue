<script setup lang="ts">
/**
 * The Archetype picker of Screen settings, an Event Reference (ADR-0038): the
 * Event's Archetypes, searched by name since an Event can hold many. It lists
 * an Empty Archetype too, marked, since a Screen may name one. It loads what
 * it lacks, re-reads it on Reconnect Resync (#610), and emits the Archetype's
 * id, or `null` when cleared.
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
const { emptyArchetypes } = useArchetypeHoldings(() => props.eventId);

const items = computed(() => {
	const empty = new Set(emptyArchetypes.value.map(archetype => archetype.id));
	return archetypeStore.archetypes.map(archetype => ({
		label: empty.has(archetype.id)
			? `${archetype.name} (empty)`
			: archetype.name,
		value: archetype.id,
	}));
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
