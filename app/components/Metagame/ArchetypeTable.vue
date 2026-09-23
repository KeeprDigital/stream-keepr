<script setup lang="ts">
import type { MetagameSortBy } from '~~/shared/types/enums';
import type { ArchetypeBreakdownEntry } from '~~/shared/types/metagame';
import type { TableColumn } from '#ui/types';
import type { Archetype } from '~/types';
import { LazyArchetypeKeyCardsEditModal } from '#components';

const props = defineProps<{
	entries: ArchetypeBreakdownEntry[];
	totalPlayers: number;
	loading: boolean;
	sortBy: MetagameSortBy;
	selectedArchetype?: string | null;
	isMtg?: boolean;
	/** Archetype objects used for key-card indicators and edit button.
	 *  Required when isMtg is true; consumers must pre-load and pass this. */
	archetypes?: Archetype[];
}>();

const emit = defineEmits<{
	(e: 'select', archetype: string | null): void;
	(e: 'update:sortBy', value: MetagameSortBy): void;
}>();

const overlay = useOverlay();

const SORTABLE_FIELDS = new Set<MetagameSortBy>(['count', 'winRate', 'metaShare', 'conversionRate']);

const sorting = ref([{ id: props.sortBy, desc: true }]);

watch(() => props.sortBy, (sortBy) => {
	if (sorting.value[0]?.id !== sortBy)
		sorting.value = [{ id: sortBy, desc: true }];
});

watch(sorting, (value) => {
	const nextSortBy = value[0]?.id;
	if (nextSortBy && SORTABLE_FIELDS.has(nextSortBy as MetagameSortBy) && nextSortBy !== props.sortBy)
		emit('update:sortBy', nextSortBy as MetagameSortBy);
}, { deep: true });

const columns: TableColumn<ArchetypeBreakdownEntry>[] = [
	{ accessorKey: 'name', header: createSortableHeader('Archetype'), enableSorting: true },
	{ accessorKey: 'count', header: createSortableHeader('Count'), enableSorting: true },
	{ accessorKey: 'metaShare', header: createSortableHeader('Share'), enableSorting: true },
	{ accessorKey: 'winRate', header: createSortableHeader('Win Rate'), enableSorting: true },
	{ accessorKey: 'avgPosition', header: createSortableHeader('Avg Place'), enableSorting: true },
	{ accessorKey: 'conversionRate', header: createSortableHeader('Conversion'), enableSorting: true },
	{ id: 'actions', header: '', enableSorting: false },
];

function findArchetype(archetypeId: number): Archetype | undefined {
	return props.archetypes?.find(a => a.id === archetypeId);
}

const maxShare = computed(() => maxMetaShare(props.entries));

async function openKeyCardsEdit(archetypeId: number) {
	const archetype = findArchetype(archetypeId);
	if (!archetype)
		return;

	const modal = overlay.create(LazyArchetypeKeyCardsEditModal);
	await modal.open({
		archetypeName: archetype.name,
		archetypeId: archetype.id,
		currentKeyCards: archetype.keyCards?.map(c => c.name) ?? [],
	});
}
</script>

<template>
	<div v-if="entries.length === 0 && !loading" class="text-center text-muted py-8">
		No archetype data available
	</div>

	<div v-else class="relative">
		<UTable
			v-if="entries.length > 0"
			v-model:sorting="sorting"
			:data="entries"
			:columns="columns"
			:class="loading ? 'opacity-60 pointer-events-none' : ''"
			:ui="{
				tr: 'cursor-pointer transition-colors',
			}"
			@select="(_e, row) => emit('select', row.original.name === selectedArchetype ? null : row.original.name)"
		>
			<template #name-cell="{ row }">
				<div class="flex flex-col gap-1.5 py-1">
					<div class="flex items-center gap-2">
						<span
							class="font-medium"
							:class="{
								'text-primary': row.original.name === selectedArchetype,
							}"
						>
							{{ row.original.name }}
						</span>
						<MtgManaColorDisplay
							v-if="isMtg && row.original.colors"
							:colors="row.original.colors"
							size="xs"
							:cost="true"
						/>
						<UIcon
							v-if="row.original.name === selectedArchetype"
							name="i-lucide-filter"
							class="h-3.5 w-3.5 text-primary shrink-0"
						/>
					</div>

					<div v-if="isMtg && row.original.keyCards.length > 0" class="flex flex-wrap gap-1">
						<UBadge
							v-for="card in row.original.keyCards.slice(0, 2)"
							:key="card.id"
							color="info"
							variant="soft"
							size="xs"
						>
							{{ card.name }}
						</UBadge>
						<span v-if="row.original.keyCards.length > 2" class="text-xs text-muted">
							+{{ row.original.keyCards.length - 2 }} more
						</span>
					</div>
				</div>
			</template>
			<template #metaShare-cell="{ row }">
				<MetagameMetaShareBar :value="row.original.metaShare" :max="maxShare" />
			</template>
			<template #winRate-cell="{ row }">
				<span class="tabular-nums">{{ formatPercent(row.original.winRate) }}</span>
			</template>
			<template #avgPosition-cell="{ row }">
				<span class="tabular-nums">{{ row.original.avgPosition ?? '-' }}</span>
			</template>
			<template #conversionRate-cell="{ row }">
				<span class="tabular-nums">{{ formatPercent(row.original.conversionRate) }}</span>
			</template>
			<template #actions-cell="{ row }">
				<UButton
					v-if="isMtg && findArchetype(row.original.id)"
					icon="i-lucide-key-round"
					color="neutral"
					variant="ghost"
					size="xs"
					@click.stop="openKeyCardsEdit(row.original.id)"
				/>
			</template>
		</UTable>

		<div v-else class="py-8" />

		<div
			v-if="loading"
			data-testid="archetype-table-loading-overlay"
			class="absolute inset-0 flex items-center justify-center bg-default/70"
		>
			<UILoadingSpinner />
		</div>
	</div>
</template>
