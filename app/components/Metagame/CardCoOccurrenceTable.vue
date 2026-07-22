<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { CardCoOccurrenceEntry } from '~~/shared/types/metagame';

const props = defineProps<{
	entries: CardCoOccurrenceEntry[];
}>();

const eventStore = useEventStore();
const {
	search,
	excludedTypes,
	uniqueCardTypes,
	visibleExcludedTypes,
	hasExclusions,
	hasFilterOverrides,
	getTypeLabel,
	toggleType,
	resetFilters,
	filteredEntries,
} = useMetagameCardFilters(computed(() => props.entries), { defaultExcludedTypes: ['Land'] });

const sorting = ref([{ id: 'coOccurrenceRate', desc: true }]);

const maxCoOccurrenceRate = computed(() =>
	Math.max(...filteredEntries.value.map(e => e.coOccurrenceRate), 1),
);

const columns: TableColumn<CardCoOccurrenceEntry>[] = [
	createNameColumn<CardCoOccurrenceEntry>(),
	createManaCostColumn<CardCoOccurrenceEntry>(),
	createCardTypeColumn<CardCoOccurrenceEntry>(),
	{ accessorKey: 'coOccurrenceRate', header: createSortableHeader('Co-occurrence'), enableSorting: true },
	createDeckCountColumn<CardCoOccurrenceEntry>(),
];
</script>

<template>
	<UCard :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<div class="flex items-center justify-between gap-3 flex-wrap">
				<h3 class="text-base font-semibold">
					Frequently Played Alongside
				</h3>
			</div>
		</template>

		<div class="flex flex-col gap-3 px-4 py-3 sm:px-6">
			<div class="flex items-center gap-3">
				<UInput
					v-model="search"
					icon="i-lucide-search"
					placeholder="Search cards…"
					class="w-56"
				/>
				<span v-if="hasExclusions || hasFilterOverrides" class="text-xs text-muted">
					{{ hasExclusions ? `${visibleExcludedTypes.length} type${visibleExcludedTypes.length === 1 ? '' : 's'} hidden` : 'Filters changed' }}
					<UButton
						variant="link"
						size="xs"
						color="primary"
						class="ml-1"
						@click="resetFilters"
					>
						Reset
					</UButton>
				</span>
			</div>

			<UFieldGroup v-if="uniqueCardTypes.length > 0" size="xs" class="flex-wrap">
				<UButton
					v-for="type in uniqueCardTypes"
					:key="type"
					:color="excludedTypes.has(type) ? 'neutral' : 'primary'"
					:variant="excludedTypes.has(type) ? 'outline' : 'soft'"
					:class="excludedTypes.has(type) ? 'line-through opacity-60' : ''"
					@click="toggleType(type)"
				>
					{{ getTypeLabel(type) }}
				</UButton>
			</UFieldGroup>
		</div>

		<UTable
			v-model:sorting="sorting"
			:data="filteredEntries"
			:columns="columns"
			:ui="{ tr: 'cursor-pointer transition-colors' }"
			@select="(_e, row) => navigateTo(`/event/${eventStore.eventId}/metagame/card/${row.original.id}`)"
		>
			<template #coOccurrenceRate-cell="{ row }">
				<MetagameMetaShareBar :value="row.original.coOccurrenceRate" :max="maxCoOccurrenceRate" />
			</template>
		</UTable>
	</UCard>
</template>
