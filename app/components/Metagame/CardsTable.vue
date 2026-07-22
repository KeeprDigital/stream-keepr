<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { MetagameCardBoardFilter, MetagameCardSortBy } from '~~/shared/types/enums';
import type { CardBreakdownEntry } from '~~/shared/types/metagame';

const props = defineProps<{
	entries: CardBreakdownEntry[];
	totalDecks?: number;
	loading?: boolean;
	sortBy: MetagameCardSortBy;
	boardFilter: MetagameCardBoardFilter;
	showDeckCount?: boolean;
	/** When provided, row clicks navigate to this path */
	getRowLink?: (entry: CardBreakdownEntry) => string;
}>();

const emit = defineEmits<{
	(e: 'update:sortBy', value: MetagameCardSortBy): void;
	(e: 'update:boardFilter', value: MetagameCardBoardFilter): void;
}>();

// ── Filters ──

const showMainboard = computed(() => props.boardFilter !== 'sideboard');
const showSideboard = computed(() => props.boardFilter !== 'mainboard');
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

function toggleMainboard() {
	if (showMainboard.value && !showSideboard.value)
		return;
	emit('update:boardFilter', props.boardFilter === 'both' ? 'sideboard' : 'both');
}

function toggleSideboard() {
	if (showSideboard.value && !showMainboard.value)
		return;
	emit('update:boardFilter', props.boardFilter === 'both' ? 'mainboard' : 'both');
}

// ── Table ──

const SORTABLE_FIELDS = new Set<MetagameCardSortBy>(['inclusionRate', 'avgCopies', 'totalCopies']);

const sorting = ref([{ id: props.sortBy, desc: true }]);

watch(() => props.sortBy, (sortBy) => {
	if (sorting.value[0]?.id !== sortBy)
		sorting.value = [{ id: sortBy, desc: true }];
});

watch(sorting, (value) => {
	const nextSortBy = value[0]?.id;
	if (nextSortBy && SORTABLE_FIELDS.has(nextSortBy as MetagameCardSortBy) && nextSortBy !== props.sortBy)
		emit('update:sortBy', nextSortBy as MetagameCardSortBy);
}, { deep: true });

const columns = computed<TableColumn<CardBreakdownEntry>[]>(() => [
	createNameColumn<CardBreakdownEntry>(),
	createManaCostColumn<CardBreakdownEntry>(),
	createCardTypeColumn<CardBreakdownEntry>(),
	{ accessorKey: 'inclusionRate', header: createSortableHeader('Inclusion'), enableSorting: true },
	{ accessorKey: 'avgCopies', header: createSortableHeader('Avg Copies'), enableSorting: true },
	{ accessorKey: 'totalCopies', header: createSortableHeader('Total Copies'), enableSorting: true },
	...(props.showDeckCount !== false ? [createDeckCountColumn<CardBreakdownEntry>()] : []),
	{ accessorKey: 'mainboardCount', header: createSortableHeader('MB'), enableSorting: true },
	{ accessorKey: 'sideboardCount', header: createSortableHeader('SB'), enableSorting: true },
]);

function handleRowClick(_e: unknown, row: { original: CardBreakdownEntry }) {
	if (props.getRowLink)
		void navigateTo(props.getRowLink(row.original));
}

const maxInclusionRate = computed(() =>
	Math.max(...filteredEntries.value.map(e => e.inclusionRate), 1),
);
</script>

<template>
	<UCard :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<div class="flex items-center justify-between gap-3 flex-wrap">
				<div>
					<h3 class="text-base font-semibold">
						Most Played Cards
					</h3>
					<p class="text-sm text-muted mt-1">
						Sortable card usage across the current scope.
					</p>
				</div>
				<div class="flex items-center gap-3 flex-wrap justify-end">
					<UBadge v-if="totalDecks && totalDecks > 0" variant="subtle" color="neutral">
						{{ totalDecks }} decks
					</UBadge>
				</div>
			</div>
		</template>

		<!-- Filters -->
		<div class="flex flex-col gap-3 px-4 py-3 sm:px-6">
			<div class="flex items-center gap-3">
				<UInput
					v-model="search"
					icon="i-lucide-search"
					placeholder="Search cards…"
					class="w-56"
				/>
				<UFieldGroup size="sm">
					<UButton
						:color="showMainboard ? 'primary' : 'neutral'"
						:variant="showMainboard ? 'soft' : 'outline'"
						:disabled="showMainboard && !showSideboard"
						@click="toggleMainboard"
					>
						Main
					</UButton>
					<UButton
						:color="showSideboard ? 'primary' : 'neutral'"
						:variant="showSideboard ? 'soft' : 'outline'"
						:disabled="showSideboard && !showMainboard"
						@click="toggleSideboard"
					>
						Side
					</UButton>
				</UFieldGroup>
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

		<div class="relative">
			<UTable
				v-if="filteredEntries.length > 0"
				v-model:sorting="sorting"
				:data="filteredEntries"
				:columns="columns"
				:class="loading ? 'opacity-60 pointer-events-none' : ''"
				:ui="getRowLink ? { tr: 'cursor-pointer transition-colors' } : {}"
				@select="handleRowClick"
			>
				<template #inclusionRate-cell="{ row }">
					<MetagameMetaShareBar :value="row.original.inclusionRate" :max="maxInclusionRate" />
				</template>
				<template #avgCopies-cell="{ row }">
					<span class="tabular-nums">{{ row.original.avgCopies }}</span>
				</template>
				<template #totalCopies-cell="{ row }">
					<span class="tabular-nums">{{ row.original.totalCopies }}</span>
				</template>
				<template #mainboardCount-cell="{ row }">
					<span class="tabular-nums text-muted">{{ row.original.mainboardCount }}</span>
				</template>
				<template #sideboardCount-cell="{ row }">
					<span class="tabular-nums text-muted">{{ row.original.sideboardCount }}</span>
				</template>
			</UTable>

			<div v-else class="text-center text-muted py-8">
				No cards match the current filters
			</div>

			<div
				v-if="loading"
				data-testid="cards-table-loading-overlay"
				class="absolute inset-0 flex items-center justify-center bg-default/70"
			>
				<UILoadingSpinner />
			</div>
		</div>
	</UCard>
</template>
