<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui';
import type { RowSelectionState } from '@tanstack/vue-table';
import type { Player, PlayerListSummary } from '~/types';
import { getFilteredRowModel } from '@tanstack/vue-table';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';

interface Props {
	players: Player[];
	loading?: boolean;
	globalFilter?: string;
	lists?: PlayerListSummary[];
	activeListId?: number | null;
}

const props = withDefaults(defineProps<Props>(), {
	loading: false,
	globalFilter: '',
	lists: () => [],
	activeListId: null,
});

const emit = defineEmits<{
	addToList: [listId: number, playerIds: number[]];
	removeFromList: [listId: number, playerIds: number[]];
	editPlayer: [player: Player];
	deletePlayer: [player: Player];
	viewDeckList: [player: Player];
	sendDeckToScreen: [playerId: number, screenId?: number];
	sendMatchHistoryToScreen: [playerId: number, screenId?: number];
}>();

// Global deck cache (persistent across tab switches)
const { getDeckLists, getActiveDeckForPlayer } = usePlayerDeckCache();

// Send deck to screen — read-only for menu building
const { hasDeckScreens, deckScreens } = useSendDeckToScreen();
const { hasPlayerHistoryScreens, playerHistoryScreens } = useSendPlayerHistoryToScreen();

// Deck resolution helpers (read from global cache)
function getPlayerDeckLists(player: Player) {
	return getDeckLists(player);
}

function getPlayerActiveDeck(player: Player) {
	return getActiveDeckForPlayer(player);
}

// Sorting state
const sorting = ref<Array<{ id: string; desc: boolean }>>([
	{
		id: 'position',
		desc: false,
	},
]);

// Row selection state (TanStack managed)
const rowSelection = ref<RowSelectionState>({});

const selectedPlayerIds = computed(() =>
	Object.keys(rowSelection.value)
		.filter(key => rowSelection.value[key])
		.map(Number),
);

function clearSelection() {
	rowSelection.value = {};
}

// Clear selection when switching lists
watch(() => props.activeListId, () => {
	clearSelection();
});

// Expose selection state for parent (toolbar bulk actions)
defineExpose({ selectedPlayerIds, clearSelection });

// Global filter options with custom filter function
const globalFilterOptions = {
	getFilteredRowModel: getFilteredRowModel<Player>(),
	globalFilterFn: (row: { original: Player }, _columnId: string, filterValue: string) => {
		const player = row.original;
		const query = filterValue.toLowerCase();
		if (player.name.toLowerCase().includes(query))
			return true;
		// Search across all deck names, not just the active one
		const deckLists = getPlayerDeckLists(player);
		return deckLists.some((dl: { name?: string | null }) => dl.name?.toLowerCase().includes(query));
	},
};

// Row-level actions: a screen choice is a submenu once more than one Screen could take it.
function getRowMenuItems(player: Player): DropdownMenuItem[][] {
	const sendItems: DropdownMenuItem[] = [];

	if (props.lists.length > 0) {
		sendItems.push({
			label: 'Add to List',
			icon: 'i-lucide-list-plus',
			children: props.lists.map(list => ({
				label: list.name,
				icon: 'i-lucide-list',
				onSelect: () => emit('addToList', list.id, [player.id]),
			})),
		});
	}

	if (getMtgGameData(player.gameData).deckName && hasDeckScreens.value) {
		sendItems.push(deckScreens.value.length === 1
			? {
					label: 'Send Deck to Screen',
					icon: 'i-lucide-send',
					onSelect: () => emit('sendDeckToScreen', player.id),
				}
			: {
					label: 'Send Deck to…',
					icon: 'i-lucide-send',
					children: deckScreens.value.map(screen => ({
						label: screen.name,
						icon: 'i-lucide-monitor',
						onSelect: () => emit('sendDeckToScreen', player.id, screen.id),
					})),
				});
	}

	if (hasPlayerHistoryScreens.value) {
		sendItems.push(playerHistoryScreens.value.length === 1
			? {
					label: 'Send Match History to Screen',
					icon: 'i-lucide-history',
					onSelect: () => emit('sendMatchHistoryToScreen', player.id),
				}
			: {
					label: 'Send Match History to…',
					icon: 'i-lucide-history',
					children: playerHistoryScreens.value.map(screen => ({
						label: screen.name,
						icon: 'i-lucide-monitor',
						onSelect: () => emit('sendMatchHistoryToScreen', player.id, screen.id),
					})),
				});
	}

	const destructiveItems: DropdownMenuItem[] = [];
	if (props.activeListId !== null) {
		destructiveItems.push({
			label: 'Remove from List',
			icon: 'i-lucide-list-minus',
			color: 'error',
			onSelect: () => emit('removeFromList', props.activeListId!, [player.id]),
		});
	}
	destructiveItems.push({
		label: 'Delete Player',
		icon: 'i-lucide-trash-2',
		color: 'error',
		onSelect: () => emit('deletePlayer', player),
	});

	return [
		[
			{
				label: 'Edit Player',
				icon: 'i-lucide-pencil',
				onSelect: () => emit('editPlayer', player),
			},
		],
		sendItems,
		destructiveItems,
	].filter(group => group.length > 0);
}

// Lazy dropdown: only mount UDropdownMenu when the trigger is clicked
const activeDropdownPlayerId = ref<number | null>(null);

function toggleDropdown(playerId: number) {
	activeDropdownPlayerId.value = activeDropdownPlayerId.value === playerId
		? null
		: playerId;
}

// Static table config (avoid re-allocation on every render)
const tableUi = { root: 'flex-1 min-h-0' };
function getRowId(row: Player) {
	return String(row.id);
}

const eventStore = useEventStore();

function formatRecord(player: Player): string {
	return formatPlayerRecord(player, eventStore.displayEvent);
}

// Table columns with sorting functionality
const columns = computed<TableColumn<Player>[]>(() => {
	const cols: TableColumn<Player>[] = [
		{
			id: 'select',
			header: ({ table }) => h(resolveComponent('UCheckbox') as any, {
				'modelValue': table.getIsSomePageRowsSelected()
					? 'indeterminate'
					: table.getIsAllPageRowsSelected(),
				'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!value),
				'ariaLabel': 'Select all',
			}),
			cell: ({ row }) => h(resolveComponent('UCheckbox') as any, {
				'modelValue': row.getIsSelected(),
				'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value),
				'ariaLabel': 'Select row',
			}),
		},
		{
			accessorKey: 'position',
			header: createSortableHeader('#'),
			enableSorting: true,
		},
		{
			accessorKey: 'name',
			header: createSortableHeader('Name'),
			enableSorting: true,
		},
		{
			accessorKey: 'pronouns',
			header: createSortableHeader('Pronouns'),
			enableSorting: true,
		},
		{
			id: 'record',
			accessorFn: row => (row.wins ?? 0) * 1000 + (row.losses ?? 0),
			header: createSortableHeader('Record'),
			enableSorting: true,
		},
		{
			accessorKey: 'points',
			header: createSortableHeader('Pts'),
			enableSorting: true,
		},
		{
			id: 'deckName',
			accessorFn: row => getPlayerActiveDeck(row)?.name ?? '',
			header: createSortableHeader('Deck'),
			enableSorting: true,
		},
	];

	cols.push({
		id: 'actions',
		header: '',
	});

	return cols;
});
</script>

<template>
	<div class="flex flex-col flex-1 min-h-0">
		<!-- No data: prominent empty state -->
		<UIEmptyState
			v-if="players.length === 0 && !loading"
			icon="i-lucide-users"
			:title="activeListId !== null ? 'No players in this list' : 'No players'"
			:description="activeListId !== null ? 'Add players to this list to see them here.' : 'No players are available for this view.'"
		/>

		<!-- Table -->
		<UTable
			v-else
			v-model:sorting="sorting"
			v-model:row-selection="rowSelection"
			:virtualize="{ estimateSize: () => 44, overscan: 10 }"
			:global-filter="globalFilter"
			:data="players"
			:columns="columns"
			:loading="props.loading"
			:global-filter-options="globalFilterOptions"
			:get-row-id="getRowId"
			:watch-options="{ deep: false }"
			:ui="tableUi"
		>
			<template #empty>
				<UIEmptyState
					variant="inline"
					icon="i-lucide-search-x"
					title="No results found"
					description="Try a different search term."
				/>
			</template>

			<template #position-cell="{ row }">
				<span class="font-mono text-muted">{{ row.original.position ?? '-' }}</span>
			</template>

			<template #name-cell="{ row }">
				<PlayerMatchHistoryButton :player="row.original" />
			</template>

			<template #pronouns-cell="{ row }">
				<span class="text-muted">{{ row.original.pronouns || '-' }}</span>
			</template>

			<template #record-cell="{ row }">
				<span class="font-mono">{{ formatRecord(row.original) }}</span>
			</template>

			<template #points-cell="{ row }">
				<span class="font-mono">{{ row.original.points ?? '-' }}</span>
			</template>

			<template #deckName-cell="{ row }">
				<button
					v-if="getMtgGameData(row.original.gameData).deckName"
					type="button"
					class="flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors cursor-pointer"
					title="View Deck List"
					@click="emit('viewDeckList', row.original)"
				>
					<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
					<span>{{ getPlayerActiveDeck(row.original)?.name || '-' }}</span>
					<MtgManaColorDisplay
						v-if="getPlayerActiveDeck(row.original)?.colors"
						:colors="getPlayerActiveDeck(row.original)?.colors"
						size="xs"
						:cost="true"
						class="shrink-0"
					/>
					<UBadge
						v-if="getPlayerDeckLists(row.original).length > 1"
						color="neutral"
						variant="subtle"
						size="xs"
					>
						+{{ getPlayerDeckLists(row.original).length - 1 }}
					</UBadge>
				</button>
				<span v-else class="text-muted">-</span>
			</template>

			<template #actions-cell="{ row }">
				<!-- Mounted once opened: a menu per row costs the virtualized table too much. -->
				<UDropdownMenu
					v-if="activeDropdownPlayerId === row.original.id"
					:open="true"
					:items="getRowMenuItems(row.original)"
					@update:open="activeDropdownPlayerId = null"
				>
					<UButton
						variant="ghost"
						color="neutral"
						size="xs"
						icon="i-lucide-more-horizontal"
						aria-label="Player actions"
					/>
				</UDropdownMenu>
				<UButton
					v-else
					variant="ghost"
					color="neutral"
					size="xs"
					icon="i-lucide-more-horizontal"
					aria-label="Player actions"
					@click.stop="toggleDropdown(row.original.id)"
				/>
			</template>
		</UTable>
	</div>
</template>
