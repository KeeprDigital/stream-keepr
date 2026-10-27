<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui';
import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { Player } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { formatGameScore } from '~~/shared/utils/matchFromPlayerSide';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';

const props = defineProps<{
	player: Player;
	/** The Player this modal showed before, when it was opened from their history. */
	previousPlayer?: Player | null;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'back'): void;
}>();

const { hasPlayerHistoryScreens, playerHistoryScreens, sendToScreen, sendToFirstPlayerHistoryScreen } = useSendPlayerHistoryToScreen();
const { openPlayerDeckList } = usePlayerDeckListModal();
const { openPlayerEdit } = usePlayerEditModal();
const { headToHeadScreens, hasHeadToHeadScreens, sendToScreen: sendHeadToHeadToScreen } = useSendHeadToHeadToScreen();
const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();
const eventStore = useEventStore();

const { player: answeredPlayer, history, loading, error } = usePlayerMatchHistory(() => props.player.id);

// The roster's copy follows an edit made from this modal, then the read's, then the Player it opened with.
const shownPlayer = computed(() => playerStore.players.find(p => p.id === props.player.id) ?? answeredPlayer.value ?? props.player);
const record = computed(() => formatPlayerRecord(shownPlayer.value, eventStore.displayEvent));
const identity = computed(() => [
	eventStore.event?.pronounsEnabled !== false
		? shownPlayer.value.pronouns
		: null,
	eventStore.event?.lgsEnabled
		? shownPlayer.value.lgs
		: null,
].filter(Boolean).join(' · '));
const hasDeckList = computed(() => !!getMtgGameData(shownPlayer.value.gameData).deckName);

onMounted(() => {
	if (!playerListStore.isLoaded && eventStore.eventId)
		void playerListStore.loadByEventId(eventStore.eventId);
});

// Each Player List, checked when the Player is a member; choosing one adds or removes them.
const listItems = computed<DropdownMenuItem[][]>(() => [
	playerListStore.lists.map((list) => {
		const isMember = playerListStore.getCachedMemberIds(list.id)?.includes(shownPlayer.value.id) ?? false;
		return {
			label: list.name,
			type: 'checkbox' as const,
			checked: isMember,
			onUpdateChecked: (checked: boolean) => void toggleListMembership(list.id, checked),
			onSelect: (event: Event) => event.preventDefault(),
		};
	}),
]);

async function toggleListMembership(listId: number, add: boolean) {
	if (!eventStore.eventId)
		return;
	if (add)
		await playerListStore.addMembers(eventStore.eventId, listId, [shownPlayer.value.id]);
	else
		await playerListStore.batchRemoveMembers(eventStore.eventId, listId, [shownPlayer.value.id]);
}
const sorting = ref([
	{ id: 'roundNumber', desc: false },
]);

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
	{
		id: 'actions',
		header: '',
	},
];

// The shown Player on the left, their opponent on the right.
function headToHeadItems(row: PlayerMatchHistoryEntry): DropdownMenuItem[][] {
	const opponentId = row.opponentId;
	if (!opponentId)
		return [];
	return [
		headToHeadScreens.value.map(screen => ({
			label: `Send Head-to-Head to ${screen.name}`,
			icon: 'i-lucide-monitor',
			onSelect: () => void sendHeadToHeadToScreen(shownPlayer.value.id, opponentId, screen),
		})),
	];
}

/** Its Game Score; a bye or a pending Match, which the Outcome names, has none. */
function formatResult(row: PlayerMatchHistoryEntry) {
	return formatGameScore(row) ?? '—';
}

function outcomeLabel(outcome: PlayerMatchHistoryEntry['outcome']) {
	return ({
		win: 'Win',
		loss: 'Loss',
		draw: 'Draw',
		bye: 'Bye',
		pending: 'Pending',
	})[outcome];
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
				<UButton
					v-if="previousPlayer"
					icon="i-lucide-arrow-left"
					color="neutral"
					variant="ghost"
					size="xs"
					:aria-label="`Back to ${previousPlayer.name}`"
					@click="emit('back')"
				>
					{{ previousPlayer.name }}
				</UButton>
				<span>{{ shownPlayer.name }} Match History</span>
				<UBadge color="neutral" variant="soft" data-testid="player-record">
					{{ record }}
				</UBadge>
				<UBadge v-if="shownPlayer.position" color="neutral" variant="outline">
					#{{ shownPlayer.position }}
				</UBadge>
			</div>
		</template>

		<template v-if="identity" #description>
			<span data-testid="player-identity">{{ identity }}</span>
		</template>

		<template #body>
			<div v-if="loading" class="py-10 flex justify-center">
				<UILoadingSpinner />
			</div>

			<UIEmptyState
				v-else-if="error && history.length === 0"
				icon="i-lucide-circle-alert"
				title="Failed to load match history"
				description="It will try again shortly."
			/>

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
					<PlayerMatchHistoryButton class="font-medium" :player="resolveOpponent(row.original)" :name="row.original.opponentName" />
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
				<template #actions-cell="{ row }">
					<UDropdownMenu v-if="hasHeadToHeadScreens && row.original.opponentId" :items="headToHeadItems(row.original)">
						<UButton
							icon="i-lucide-swords"
							color="neutral"
							variant="ghost"
							size="xs"
							:aria-label="`Send Head-to-Head with ${row.original.opponentName} to Screen`"
						/>
					</UDropdownMenu>
				</template>
			</UTable>
		</template>

		<template #footer>
			<div class="flex flex-wrap items-center gap-2 w-full">
				<UButton
					icon="i-lucide-pencil"
					color="neutral"
					variant="outline"
					@click="openPlayerEdit(shownPlayer)"
				>
					Edit Player
				</UButton>
				<UButton
					v-if="hasDeckList"
					icon="i-lucide-list"
					color="neutral"
					variant="outline"
					@click="openPlayerDeckList(shownPlayer)"
				>
					Deck List
				</UButton>
				<UDropdownMenu v-if="playerListStore.lists.length > 0" :items="listItems">
					<UButton
						icon="i-lucide-list-plus"
						color="neutral"
						variant="outline"
						trailing-icon="i-lucide-chevron-down"
					>
						Lists
					</UButton>
				</UDropdownMenu>
				<div class="flex-1" />
				<template v-if="hasPlayerHistoryScreens">
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
				</template>
			</div>
		</template>
	</UModal>
</template>
