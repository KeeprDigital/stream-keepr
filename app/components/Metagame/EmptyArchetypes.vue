<script setup lang="ts">
import { LazyUIConfirmActionModal } from '#components';
import { countOf } from '~/composables/data/useArchetypeHoldings';

/**
 * The Event's Empty Archetypes, which the Archetype table cannot list: it
 * counts Pilots, and these have none. Each links to its page, where it can be
 * renamed, merged or deleted, and all can be removed at once. Shown only while
 * there is one.
 */
const props = defineProps<{
	eventId: number;
}>();

const archetypeStore = useArchetypeStore();
const { emptyArchetypes } = useArchetypeHoldings(() => props.eventId);
const confirmModal = useOverlay().create(LazyUIConfirmActionModal);
const removing = ref(false);

async function removeAll() {
	const names = emptyArchetypes.value.map(archetype => archetype.name);
	const confirmed = await confirmModal.open({
		title: 'Remove empty archetypes',
		message: `Remove ${countOf(names.length, 'empty archetype')}?`,
		description: `${names.join(', ')}. No deck is assigned to ${names.length === 1
			? 'it'
			: 'them'}. A Screen showing one will show no Archetype.`,
		confirmLabel: 'Remove all',
		confirmColor: 'error',
		icon: 'i-lucide-trash-2',
		iconColor: 'text-error',
	}).result;
	if (!confirmed)
		return;

	removing.value = true;
	try {
		await archetypeStore.removeEmptyArchetypes(props.eventId);
	}
	finally {
		removing.value = false;
	}
}
</script>

<template>
	<div
		v-if="emptyArchetypes.length > 0"
		class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-default px-4 py-3 text-sm"
		data-empty-archetypes
	>
		<span class="text-muted">{{ countOf(emptyArchetypes.length, 'empty archetype') }}, with no deck assigned:</span>
		<NuxtLink
			v-for="archetype in emptyArchetypes"
			:key="archetype.id"
			:to="`/event/${eventId}/metagame/archetype/${archetype.id}`"
			class="font-medium hover:underline"
		>
			{{ archetype.name }}
		</NuxtLink>
		<UButton
			label="Remove all"
			aria-label="Remove all empty archetypes"
			icon="i-lucide-trash-2"
			size="xs"
			color="error"
			variant="soft"
			class="ml-auto"
			:loading="removing"
			@click="removeAll"
		/>
	</div>
</template>
