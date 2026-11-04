<script setup lang="ts">
/**
 * The Player List picker of Screen settings, an Event Reference (ADR-0038):
 * each of the Event's Player Lists with its member count, or, while the Event
 * has none, where to make one. It emits the list's id, or the `null` that
 * deletes the reference (ADR-0041). The editor loads the lists.
 */
defineProps<{
	modelValue?: number | null;
	description: string;
}>();

const emit = defineEmits<{
	'update:modelValue': [playerListId: number | null];
}>();

const playerListStore = usePlayerListStore();

const options = computed(() => [
	{ label: 'Select a list...', value: null },
	...playerListStore.lists.map(list => ({
		label: `${list.name} (${list.memberCount})`,
		value: list.id,
	})),
]);
</script>

<template>
	<ScreenSettingsField
		v-if="playerListStore.lists.length > 0"
		label="Select list"
		:description="description"
	>
		<USelect
			:model-value="modelValue ?? null"
			:items="options"
			class="w-64"
			@update:model-value="emit('update:modelValue', ($event as number | null | undefined) ?? null)"
		/>
	</ScreenSettingsField>
	<div v-else class="text-sm text-muted text-center py-2">
		No player lists available. Create one on the Players page.
	</div>
</template>
