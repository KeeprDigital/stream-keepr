<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * Renames an Archetype. On a One Piece Card Game Event a rename customises the
 * Archetype, so its name stays through Leader clashes and it outlives its last
 * Player (ADR-0074).
 */
const props = defineProps<{
	eventId: number;
	archetypeId: number;
}>();

const archetypeStore = useArchetypeStore();

useConsumedEventData(['archetypes']);

onMounted(async () => {
	if (!archetypeStore.isLoaded)
		await archetypeStore.loadByEventId(props.eventId);
});

const archetype = computed(() => archetypeStore.archetypes.find(item => item.id === props.archetypeId));
const draft = ref('');

watch(() => archetype.value?.name, (name) => {
	draft.value = name ?? '';
}, { immediate: true });

const typed = computed(() => draft.value.trim());
const canRename = computed(() => typed.value !== '' && typed.value !== archetype.value?.name);

async function rename() {
	if (!canRename.value)
		return;
	await archetypeStore.updateArchetype(props.eventId, props.archetypeId, { name: typed.value });
}
</script>

<template>
	<div v-if="archetype" class="flex items-center gap-2">
		<span class="text-sm text-muted whitespace-nowrap">Name</span>
		<UInput
			v-model="draft"
			class="w-64"
			aria-label="Archetype name"
			@keydown.enter="rename"
		/>
		<UButton
			label="Rename"
			aria-label="Rename Archetype"
			variant="soft"
			:disabled="!canRename"
			@click="rename"
		/>
	</div>
</template>
