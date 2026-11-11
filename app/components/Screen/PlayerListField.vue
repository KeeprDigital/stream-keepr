<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Player List picker of Screen settings, an Event Reference (ADR-0038):
 * each of the Event's Player Lists with its member count, or, while the Event
 * has none, where to make one. It loads the lists it lacks, re-reads them on
 * Reconnect Resync (#610), and emits the list's id, or the `null` that deletes
 * the reference (ADR-0041).
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	eventId: number;
	label?: string;
	description?: string;
	nullLabel?: string;
}>(), {
	label: 'Player List',
	nullLabel: 'Select a list…',
});

const emit = defineEmits<{
	'update:modelValue': [playerListId: number | null];
}>();

const playerListStore = usePlayerListStore();

const items = computed(() => playerListStore.lists.map(list => ({
	label: `${list.name} (${list.memberCount})`,
	value: list.id,
})));

useConsumedEventData(['playerLists']);

onMounted(async () => {
	if (props.eventId && !playerListStore.isLoaded)
		await playerListStore.loadByEventId(props.eventId);
});
</script>

<template>
	<ScreenEventReferenceField
		v-if="items.length > 0"
		:label="label"
		:description="description"
		:null-label="nullLabel"
		:model-value="modelValue"
		:items="items"
		@update:model-value="emit('update:modelValue', $event)"
	/>
	<ScreenSettingsHint v-else-if="playerListStore.isLoaded">
		No player lists available. Create one on the Players page.
	</ScreenSettingsHint>
</template>
