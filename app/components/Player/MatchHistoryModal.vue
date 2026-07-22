<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { Player } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';

const props = defineProps<{
	player: Player;
	history: PlayerMatchHistoryEntry[];
	loading?: boolean;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const { hasPlayerHistoryScreens, playerHistoryScreens, sendToScreen, sendToFirstPlayerHistoryScreen } = useSendPlayerHistoryToScreen();
const { openPlayerDeckList } = usePlayerDeckListModal();
const playerStore = usePlayerStore();

const record = computed(() => `${props.player.wins ?? 0}-${props.player.losses ?? 0}${props.player.draws ? `-${props.player.draws}` : ''}`);
const sorting = ref([{ id: 'roundNumber', desc: false }]);

const columns: TableColumn<PlayerMatchHistoryEntry>[] = [
	{
		id: 'roundNumber',
		header: createSortableHeader('Round'),
		enableSorting: true,
		accessorFn: row => row.roundNumber,
	},
	{
		accessorKey: 'opponentName',
		header: createSortableHeader('Opponent'),
		enableSorting: true,
	},
	{
		id: 'opponentDeckName',
		header: createSortableHeader('Opponent Deck'),
		enableSorting: true,
		accessorFn: row => row.opponentDeckName ?? '',
	},
	{
		id: 'tableNumber',
		header: createSortableHeader('Table'),
		enableSorting: true,
		accessorFn: row => row.tableNumber ?? Infinity,
	},
	{
		id: 'outcome',
		header: createSortableHeader('Outcome'),
		enableSorting: true,
		accessorFn: row => outcomeLabel(row.outcome),
	},
	{
		id: 'result',
		header: createSortableHeader('Result'),
		enableSorting: true,
		accessorFn: row => formatResult(row),
	},
];

function formatResult(row: PlayerMatchHistoryEntry) {
	if (row.outcome === 'bye')
		return 'BYE';
	if (!row.hasResult)
		return 'Pending';
	if (row.playerGameWins != null && row.opponentGameWins != null)
		return `${row.playerGameWins}-${row.opponentGameWins}${row.gameDraws ? `-${row.gameDraws}` : ''}`;
	return row.resultString ?? 'Result';
}

function outcomeLabel(outcome: PlayerMatchHistoryEntry['outcome']) {
	return ({ win: 'Win', loss: 'Loss', draw: 'Draw', bye: 'Bye', pending: 'Pending' })[outcome];
}

function outcomeColor(outcome: PlayerMatchHistoryEntry['outcome']) {
	if (outcome === 'win' || outcome === 'bye')
		return 'success';
	if (outcome === 'loss')
		return 'error';
	if (outcome === 'draw')
		return 'warning';
	return 'neutral';
}

function resolveOpponent(row: PlayerMatchHistoryEntry): Player | null {
	if (!row.opponentId)
		return null;
	return playerStore.players.find(player => player.id === row.opponentId) ?? null;
}

function canViewOpponentDeck(row: PlayerMatchHistoryEntry) {
	const opponent = resolveOpponent(row);
	return !!opponent && !!getMtgGameData(opponent.gameData).deckName;
}

async function viewOpponentDeck(row: PlayerMatchHistoryEntry) {
	const opponent = resolveOpponent(row);
	if (opponent) {
		await openPlayerDeckList(opponent);
	}
}

async function handleSendToScreen(screenId?: number) {
	if (screenId) {
		const screen = playerHistoryScreens.value.find(s => s.id === screenId);
		if (screen)
			await sendToScreen(props.player.id, screen);
	}
	else {
		await sendToFirstPlayerHistoryScreen(props.player.id);
	}
}
</script>

<template>
	<UModal
		:close="{ onClick: () => emit('close') }"
		:ui="{ content: 'sm:max-w-4xl', body: 'p-0 sm:p-0' }"
	>
		<template #title>
			<div class="flex items-center gap-3">
				<span>{{ player.name }} Match History</span>
				<UBadge color="neutral" variant="soft">
					{{ record }}
				</UBadge>
				<UBadge v-if="player.position" color="neutral" variant="outline">
					#{{ player.position }}
				</UBadge>
			</div>
		</template>

		<template #body>
			<div v-if="loading" class="py-10 flex justify-center">
				<UILoadingSpinner />
			</div>

			<UIEmptyState
				v-else-if="history.length === 0"
				icon="i-lucide-history"
				title="No match history"
				description="No matches have been recorded for this player yet."
			/>

			<UTable
				v-else
				v-model:sorting="sorting"
				:data="history"
				:columns="columns"
			>
				<template #roundNumber-cell="{ row }">
					<div class="font-medium">
						{{ row.original.roundName }}
					</div>
					<div class="text-xs text-muted">
						{{ row.original.phaseName }}
					</div>
				</template>
				<template #opponentName-cell="{ row }">
					<span class="font-medium">{{ row.original.opponentName }}</span>
				</template>
				<template #opponentDeckName-cell="{ row }">
					<button
						v-if="row.original.opponentDeckName && canViewOpponentDeck(row.original)"
						type="button"
						class="flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors cursor-pointer"
						title="View Deck List"
						@click="viewOpponentDeck(row.original)"
					>
						<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
						<span>{{ row.original.opponentDeckName }}</span>
						<MtgManaColorDisplay
							v-if="row.original.opponentDeckColors"
							:colors="row.original.opponentDeckColors"
							size="xs"
							:cost="true"
							class="shrink-0"
						/>
					</button>
					<div v-else-if="row.original.opponentDeckName" class="inline-flex items-center gap-1.5 text-sm text-muted">
						<span>{{ row.original.opponentDeckName }}</span>
						<MtgManaColorDisplay
							v-if="row.original.opponentDeckColors"
							:colors="row.original.opponentDeckColors"
							size="xs"
							:cost="true"
							class="shrink-0"
						/>
					</div>
					<span v-else class="text-muted">—</span>
				</template>
				<template #tableNumber-cell="{ row }">
					<span class="font-mono text-muted">{{ row.original.tableNumber ?? '—' }}</span>
				</template>
				<template #outcome-cell="{ row }">
					<UBadge :color="outcomeColor(row.original.outcome)" variant="soft">
						{{ outcomeLabel(row.original.outcome) }}
					</UBadge>
				</template>
				<template #result-cell="{ row }">
					<span class="font-mono">{{ formatResult(row.original) }}</span>
				</template>
			</UTable>
		</template>

		<template v-if="hasPlayerHistoryScreens" #footer>
			<div class="flex justify-end gap-2">
				<UButton
					v-if="playerHistoryScreens.length === 1"
					icon="i-lucide-send"
					color="primary"
					@click="handleSendToScreen()"
				>
					Send to Screen
				</UButton>
				<UDropdownMenu
					v-else
					:items="[[...playerHistoryScreens.map(s => ({ label: s.name, icon: 'i-lucide-monitor', onSelect: () => handleSendToScreen(s.id) }))]]"
				>
					<UButton icon="i-lucide-send" color="primary" trailing-icon="i-lucide-chevron-down">
						Send to Screen
					</UButton>
				</UDropdownMenu>
			</div>
		</template>
	</UModal>
</template>
