<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { ArchetypePlayerEntry, CardPlayerEntry } from '~~/shared/types/metagame';
import type { Player } from '~/types';

type AnyPlayer = ArchetypePlayerEntry | CardPlayerEntry;

const props = defineProps<{
	players: AnyPlayer[];
	title?: string;
	emptyMessage?: string;
	/** Show deckName column with colors appended. */
	showDeckName?: boolean;
	/** Show copies column — pass for card context */
	showCopies?: boolean;
}>();

const emit = defineEmits<{
	viewDeckList: [player: Player];
}>();

const playerStore = usePlayerStore();
const sorting = ref([{ id: 'position', desc: false }]);

function resolvePlayer(entry: AnyPlayer): Player | null {
	return playerStore.players.find(player => player.id === entry.id) ?? null;
}

function viewDeckList(entry: AnyPlayer) {
	const player = resolvePlayer(entry);
	if (player) {
		emit('viewDeckList', player);
	}
}

const columns = computed<TableColumn<AnyPlayer>[]>(() => [
	{
		id: 'position',
		header: createSortableHeader('#'),
		enableSorting: true,
		accessorFn: (row: AnyPlayer) => row.position ?? Infinity,
	},
	{
		accessorKey: 'name',
		header: createSortableHeader('Player'),
		enableSorting: true,
	},
	{
		id: 'record',
		header: createSortableHeader('Record'),
		enableSorting: true,
		accessorFn: (row: AnyPlayer) => (row.wins ?? -1) * 1000 + (row.losses ?? -1),
	},
	{
		accessorKey: 'points',
		header: createSortableHeader('Points'),
		enableSorting: true,
	},
	...(props.showDeckName
		? [{
				id: 'deckName',
				header: createSortableHeader('Deck'),
				enableSorting: true,
				accessorFn: (row: AnyPlayer) => (row as ArchetypePlayerEntry).deckName ?? '',
			} as TableColumn<AnyPlayer>]
		: []),
	...(props.showCopies
		? [{
				id: 'copies',
				header: createSortableHeader('Copies'),
				enableSorting: true,
				accessorFn: (row: AnyPlayer) => (row as CardPlayerEntry).quantity ?? 0,
			} as TableColumn<AnyPlayer>]
		: []),
	{
		id: 'deckList',
		header: '',
		enableSorting: false,
	},
]);
</script>

<template>
	<UCard :ui="{ body: 'p-0 sm:p-0' }">
		<template #header>
			<div class="flex items-center justify-between">
				<h3 class="text-base font-semibold">
					{{ title ?? 'Players' }}
				</h3>
				<UBadge variant="subtle" color="neutral">
					{{ players.length }}
				</UBadge>
			</div>
		</template>

		<div v-if="players.length === 0" class="px-4 py-8 text-center text-muted">
			{{ emptyMessage ?? 'No players' }}
		</div>

		<UTable
			v-else
			v-model:sorting="sorting"
			:data="players"
			:columns="columns"
		>
			<template #position-cell="{ row }">
				<span class="text-xs text-muted tabular-nums">{{ row.original.position ?? '—' }}</span>
			</template>
			<template #name-cell="{ row }">
				<span class="font-medium">{{ row.original.name }}</span>
			</template>
			<template #record-cell="{ row }">
				<span class="tabular-nums text-sm">
					{{ row.original.wins ?? '-' }}–{{ row.original.losses ?? '-' }}–{{ row.original.draws ?? '-' }}
				</span>
			</template>
			<template #points-cell="{ row }">
				<span class="tabular-nums">{{ row.original.points ?? '-' }}</span>
			</template>
			<template v-if="showDeckName" #deckName-cell="{ row }">
				<div v-if="(row.original as ArchetypePlayerEntry).deckName" class="inline-flex items-center gap-1.5 text-sm text-muted">
					<span>{{ (row.original as ArchetypePlayerEntry).deckName }}</span>
					<MtgManaColorDisplay
						v-if="(row.original as ArchetypePlayerEntry).colors"
						:colors="(row.original as ArchetypePlayerEntry).colors!"
						size="xs"
						:cost="true"
						class="shrink-0"
					/>
				</div>
				<span v-else class="text-sm text-muted">-</span>
			</template>
			<template v-if="showCopies" #copies-cell="{ row }">
				<span class="tabular-nums text-sm">
					{{ (row.original as CardPlayerEntry).quantity }}x
					<span class="text-muted">
						{{ (row.original as CardPlayerEntry).compartment === 'mainboard' ? 'MB' : 'SB' }}
					</span>
				</span>
			</template>
			<template #deckList-cell="{ row }">
				<UButton
					v-if="resolvePlayer(row.original)"
					icon="i-lucide-list"
					color="neutral"
					variant="ghost"
					size="xs"
					aria-label="View deck list"
					title="View Deck List"
					@click="viewDeckList(row.original)"
				/>
			</template>
		</UTable>
	</UCard>
</template>
