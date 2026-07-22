<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { TokenRequirementEntry } from '~~/shared/types/metagame';

const props = defineProps<{
	entries: TokenRequirementEntry[];
	totalDecks?: number;
	loading?: boolean;
	getSourceCardLink?: (card: TokenRequirementEntry['sourceCards'][number]) => string;
}>();

const search = ref('');

const filteredEntries = computed(() => {
	const query = search.value.trim().toLowerCase();
	if (!query)
		return props.entries;

	return props.entries.filter(entry =>
		entry.name.toLowerCase().includes(query)
		|| entry.typeLine?.toLowerCase().includes(query)
		|| entry.sourceCards.some(card => card.name.toLowerCase().includes(query)),
	);
});

const sorting = ref([{ id: 'deckCount', desc: true }]);

const columns = computed<TableColumn<TokenRequirementEntry>[]>(() => [
	{
		accessorKey: 'name',
		header: createSortableHeader('Token'),
		enableSorting: true,
		cell: ({ row }) => h('span', { class: 'font-medium' }, row.original.name),
	},
	{
		accessorKey: 'typeLine',
		header: createSortableHeader('Type'),
		enableSorting: true,
		cell: ({ row }) => h('span', { class: 'text-sm text-muted' }, row.original.typeLine ?? '-'),
	},
	{
		accessorKey: 'deckCount',
		header: createSortableHeader('Decks'),
		enableSorting: true,
		cell: ({ row }) => h('span', { class: 'tabular-nums' }, String(row.original.deckCount)),
	},
	{
		accessorKey: 'sourceCardCount',
		header: createSortableHeader('Sources'),
		enableSorting: true,
		cell: ({ row }) => h('span', { class: 'tabular-nums' }, String(row.original.sourceCardCount)),
	},
	{
		id: 'sourceCards',
		header: 'Source Cards',
		enableSorting: false,
	},
]);
</script>

<template>
	<UCard :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<div class="flex items-center justify-between gap-3 flex-wrap">
				<div>
					<h3 class="text-base font-semibold">
						Required Tokens
					</h3>
					<p class="text-sm text-muted mt-1">
						Token inventory required by cards across the current scope.
					</p>
				</div>
				<UBadge v-if="totalDecks && totalDecks > 0" variant="subtle" color="neutral">
					{{ totalDecks }} decks
				</UBadge>
			</div>
		</template>

		<div class="px-4 py-3 sm:px-6">
			<UInput
				v-model="search"
				icon="i-lucide-search"
				placeholder="Search tokens or source cards..."
				class="w-72 max-w-full"
			/>
		</div>

		<div class="relative">
			<UTable
				v-if="filteredEntries.length > 0"
				v-model:sorting="sorting"
				:data="filteredEntries"
				:columns="columns"
				:class="loading ? 'opacity-60 pointer-events-none' : ''"
			>
				<template #name-cell="{ row }">
					<div class="flex items-center gap-3 min-w-0">
						<MetagameCardThumbnail
							:scryfall-id="row.original.scryfallId"
							:name="row.original.name"
							size="sm"
						/>
						<div class="min-w-0">
							<div class="font-medium truncate">
								{{ row.original.name }}
							</div>
						</div>
					</div>
				</template>

				<template #sourceCards-cell="{ row }">
					<div class="flex flex-wrap gap-1.5">
						<UButton
							v-for="card in row.original.sourceCards"
							:key="card.id"
							:to="getSourceCardLink?.(card)"
							size="xs"
							variant="soft"
							color="neutral"
						>
							{{ card.name }}
						</UButton>
					</div>
				</template>
			</UTable>

			<div v-else class="text-center text-muted py-8">
				No tokens match the current scope
			</div>

			<div
				v-if="loading"
				data-testid="tokens-table-loading-overlay"
				class="absolute inset-0 flex items-center justify-center bg-default/70"
			>
				<UILoadingSpinner />
			</div>
		</div>
	</UCard>
</template>
