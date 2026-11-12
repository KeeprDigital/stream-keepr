<script setup lang="ts">
/**
 * Merges a Magic: The Gathering Archetype into another of its Event, or deletes
 * it. Each asks first (`useArchetypeManagement`). A One Piece Card Game
 * Archetype follows its Leader and has neither (ADR-0074).
 */
const props = defineProps<{
	eventId: number;
	archetypeId: number;
}>();

const archetypeStore = useArchetypeStore();
const { mergeInto, remove } = useArchetypeManagement(() => props.eventId, () => props.archetypeId);

const others = computed(() => archetypeStore.archetypes
	.filter(archetype => archetype.id !== props.archetypeId)
	.map(archetype => ({ label: archetype.name, value: archetype.id })));

/** Never holds a pick: a merge leaves the page, and a declined one offers the list again. */
const picked = ref<number>();

async function merge(intoArchetypeId: unknown) {
	if (typeof intoArchetypeId === 'number')
		await mergeInto(intoArchetypeId);
	picked.value = undefined;
}
</script>

<template>
	<div class="flex flex-wrap items-center gap-2">
		<USelectMenu
			:model-value="picked"
			:items="others"
			value-key="value"
			placeholder="Merge into…"
			aria-label="Merge into another Archetype"
			icon="i-lucide-merge"
			class="w-64"
			:disabled="others.length === 0"
			@update:model-value="merge"
		/>
		<UButton
			label="Delete"
			aria-label="Delete Archetype"
			icon="i-lucide-trash-2"
			color="error"
			variant="soft"
			@click="remove"
		/>
	</div>
</template>
