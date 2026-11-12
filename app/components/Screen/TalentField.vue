<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Talent picker of Screen settings, an Event Reference (ADR-0038): the
 * Event's Talents, which ride on the Event itself, so it loads nothing and
 * re-reads the Event on Reconnect Resync (#610). It emits the Talent's id, or
 * `null` for none. It leaves out the `excluded` Talents, such as a lineup's.
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	label?: string;
	description?: string;
	nullLabel?: string;
	excluded?: readonly number[];
}>(), {
	label: 'Talent',
	nullLabel: 'Select a Talent…',
});

const emit = defineEmits<{
	'update:modelValue': [talentId: number | null];
}>();

const eventStore = useEventStore();

const items = computed(() => (eventStore.event?.talents ?? [])
	.filter(talent => !props.excluded?.includes(talent.id))
	.map(talent => ({ label: talent.name, value: talent.id })));

useConsumedEventData(['event']);
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
