<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { CardArchetypeEntry } from '~~/shared/types/metagame';

const props = defineProps<{
	archetypes: CardArchetypeEntry[];
}>();

const eventStore = useEventStore();

const sorting = ref([{ id: 'inclusionRate', desc: true }]);

const maxInclusionRate = computed(() =>
	Math.max(...props.archetypes.map(a => a.inclusionRate), 1),
);

const columns: TableColumn<CardArchetypeEntry>[] = [
	createNameColumn<CardArchetypeEntry>('Archetype'),
	{ accessorKey: 'inclusionRate', header: createSortableHeader('Inclusion'), enableSorting: true },
	createDeckCountColumn<CardArchetypeEntry>(),
	{ id: 'keyCard', header: '', enableSorting: false },
];
</script>

<template>
	<UCard :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<div class="flex items-center justify-between">
				<h3 class="text-base font-semibold">
					Archetypes
				</h3>
				<UBadge variant="subtle" color="neutral">
					{{ archetypes.length }}
				</UBadge>
			</div>
		</template>
		<UTable
			v-model:sorting="sorting"
			:data="archetypes"
			:columns="columns"
			:ui="{ tr: 'cursor-pointer transition-colors' }"
			@select="(_e, row) => navigateTo(`/event/${eventStore.eventId}/metagame/archetype/${row.original.id}`)"
		>
			<template #inclusionRate-cell="{ row }">
				<MetagameMetaShareBar :value="row.original.inclusionRate" :max="maxInclusionRate" />
			</template>
			<template #keyCard-cell="{ row }">
				<UTooltip v-if="row.original.isKeyCard" text="Key card for this archetype">
					<UIcon name="i-lucide-key-round" class="size-3.5 text-muted" />
				</UTooltip>
			</template>
		</UTable>
	</UCard>
</template>
