<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * Renames an Archetype, for every Deck List it holds. On a One Piece Card Game
 * Event a rename customises the Archetype, so its name stays through Leader
 * clashes and it outlives its last Player (ADR-0074).
 *
 * An Event holds one Archetype per name, ignoring case and surrounding spaces.
 * A name another Archetype holds is offered as a merge into it where
 * `mergeable`, and refused otherwise.
 */
const props = defineProps<{
	eventId: number;
	archetypeId: number;
	mergeable?: boolean;
}>();

const emit = defineEmits<{
	/** The operator asked to merge this Archetype into the one holding the typed name. */
	(e: 'merge', intoArchetypeId: number): void;
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
const holder = computed(() => typed.value === ''
	? undefined
	: archetypeStore.findNameHolder(typed.value, props.archetypeId));
const canRename = computed(() => typed.value !== '' && typed.value !== archetype.value?.name && !holder.value);

async function rename() {
	if (holder.value) {
		if (props.mergeable)
			emit('merge', holder.value.id);
		return;
	}
	if (!canRename.value)
		return;
	await archetypeStore.updateArchetype(props.eventId, props.archetypeId, { name: typed.value });
}
</script>

<template>
	<div v-if="archetype" class="flex flex-wrap items-center gap-2">
		<span class="text-sm text-muted whitespace-nowrap">Name</span>
		<UInput
			v-model="draft"
			class="w-64"
			aria-label="Archetype name"
			@keydown.enter="rename"
		/>
		<UButton
			v-if="holder && mergeable"
			:label="`Merge into ${holder.name}…`"
			:aria-label="`Merge into ${holder.name}`"
			icon="i-lucide-merge"
			variant="soft"
			@click="rename"
		/>
		<UButton
			v-else
			label="Rename"
			aria-label="Rename Archetype"
			variant="soft"
			:disabled="!canRename"
			@click="rename"
		/>
		<span v-if="holder" class="text-sm text-muted" data-name-taken>
			{{ mergeable ? `“${holder.name}” already exists.` : `Another Archetype is named “${holder.name}”.` }}
		</span>
	</div>
</template>
