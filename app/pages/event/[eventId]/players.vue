<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Player } from '~/types';
import { LazyPlayerCreateModal, LazyPlayerListCreateModal, LazyPlayerListEditModal, LazyPlayerManageModal, LazyUIConfirmDeleteModal } from '#components';

definePageMeta({
	title: 'Player List',
	layout: false,
});

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();
const phaseStore = usePhaseStore();
const roundStore = useRoundStore();
const meleeStore = useMeleeStore();
const screenStore = useScreenStore();
const overlay = useOverlay();
const { openPlayerDeckList } = usePlayerDeckListModal();
const { openPlayerMatchHistory } = usePlayerMatchHistoryModal();
const { sendToFirstDeckScreen, sendToScreen: sendDeckToScreen } = useSendDeckToScreen();
const { sendToFirstPlayerHistoryScreen, sendToScreen: sendPlayerHistoryToScreen } = useSendPlayerHistoryToScreen();
const { runRequest } = useRequestFeedback();

// Active list tab tracking
const activeListId = ref<number | null>(null);

// ── Round Selector (standings override) ──

const selectedRoundId = ref<number | undefined>(undefined);
const standingsLoading = ref(false);
const standingsError = ref<string | null>(null);
const selectedRound = computed(() => selectedRoundId.value ? roundStore.getRoundById(selectedRoundId.value) : null);
const selectedRoundCanSync = computed(() => !!(eventStore.event?.meleeEnabled && selectedRound.value?.externalSource === 'melee'));

const roundOptions = computed(() => {
	const options: Array<{ label: string; value: number | undefined }> = [
		{ label: 'Current', value: undefined },
	];

	for (const round of roundStore.rounds) {
		const phase = phaseStore.getPhaseById(round.phaseId);
		options.push({
			label: formatRoundOptionLabel(round, phase),
			value: round.id,
		});
	}

	return options;
});

const hasRoundOptions = computed(() => roundOptions.value.length > 1);

// Fetch standings snapshot when a round is selected
interface StandingsEntry { playerId: number; wins: number | null; losses: number | null; draws: number | null; position: number | null; points: number | null }
const standingsMap = ref<Map<number, StandingsEntry> | null>(null);

async function loadSelectedRoundStandings() {
	const roundId = selectedRoundId.value;
	if (!roundId || !eventStore.eventId) {
		standingsMap.value = null;
		standingsError.value = null;
		return;
	}

	standingsLoading.value = true;
	standingsError.value = null;
	try {
		const data = await $fetch<{ standings: StandingsEntry[] }>(`/api/events/${eventStore.eventId}/standings?roundId=${roundId}`);
		const map = new Map<number, StandingsEntry>();
		for (const entry of data.standings) {
			map.set(entry.playerId, entry);
		}
		standingsMap.value = map;
	}
	catch {
		standingsMap.value = null;
		standingsError.value = 'Failed to load round standings';
	}
	finally {
		standingsLoading.value = false;
	}
}

watch(selectedRoundId, loadSelectedRoundStandings);

// Search state (debounced for table performance)
const searchQuery = ref('');
const globalFilter = refDebounced(searchQuery, 200);

// Access PlayerList selection state via template ref
const playerList = useTemplateRef<{ selectedPlayerIds: number[]; clearSelection: () => void }>('playerList');
const selectedPlayerIds = computed<number[]>(() => playerList.value?.selectedPlayerIds ?? []);

// Players to display (filtered by active list, with standings override merged in)
const displayedPlayers = computed(() => {
	let players = playerStore.players;

	// Filter by active list membership
	if (activeListId.value !== null) {
		const memberIds = playerListStore.getCachedMemberIds(activeListId.value);
		if (!memberIds)
			return [];
		const idSet = new Set(memberIds);
		players = players.filter(p => idSet.has(p.id));
	}

	// Merge standings override when a round is selected.
	// If the selected round has not had standings cached yet, keep the base player list
	// rather than showing everyone with blank records.
	const override = standingsMap.value;
	if (!selectedRoundId.value || !override || override.size === 0)
		return players;

	return players.map((player) => {
		const snapshot = override.get(player.id);
		if (!snapshot) {
			// Player has no snapshot for this round — null out standings
			return { ...player, wins: null, losses: null, draws: null, position: null, points: null };
		}
		return {
			...player,
			wins: snapshot.wins,
			losses: snapshot.losses,
			draws: snapshot.draws,
			position: snapshot.position,
			points: snapshot.points,
		};
	});
});

const { eventId, initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
	{ isLoaded: () => playerListStore.isLoaded, load: id => playerListStore.loadByEventId(id) },
	{ isLoaded: () => phaseStore.isLoaded, load: id => phaseStore.loadPhasesByEventId(id) },
	{ isLoaded: () => roundStore.isLoaded, load: id => roundStore.loadRoundsByEventId(id) },
], async (id) => {
	if (!screenStore.isLoaded || screenStore.currentEventId !== id) {
		await screenStore.loadScreensByEventId(id);
	}
});

const hasPlayers = computed(() => playerStore.players.length > 0);
const pageState = computed(() => initialError.value ? 'ready' : initialLoading.value ? 'loading' : (hasPlayers.value ? 'ready' : 'empty'));

// ── List Tab Handlers ──

async function handleSelectList(listId: number | null) {
	activeListId.value = listId;

	if (listId !== null && !playerListStore.getCachedMemberIds(listId) && eventId.value) {
		await playerListStore.loadListMembers(eventId.value, listId);
	}
}

// ── Modal Handlers ──

function handleCreatePlayer() {
	const modal = overlay.create(LazyPlayerCreateModal);
	void modal.open({
		game: eventStore.event?.game ?? 'mtg',
		pronounsEnabled: eventStore.event?.pronounsEnabled ?? true,
		lgsEnabled: eventStore.event?.lgsEnabled ?? false,
	});
}

function handleEditPlayer(player: Player) {
	const modal = overlay.create(LazyPlayerManageModal);
	void modal.open({
		player,
		game: eventStore.event?.game ?? 'mtg',
		pronounsEnabled: eventStore.event?.pronounsEnabled ?? true,
		lgsEnabled: eventStore.event?.lgsEnabled ?? false,
	});
}

function handleCreateList() {
	const modal = overlay.create(LazyPlayerListCreateModal);
	void modal.open({});
}

function handleEditList(listId: number) {
	const modal = overlay.create(LazyPlayerListEditModal);
	void modal.open({
		listId,
		onDeleted: (deletedListId: number) => {
			if (activeListId.value === deletedListId) {
				activeListId.value = null;
			}
		},
	});
}

// ── Player Action Handlers ──

async function handleDeletePlayer(player: Player) {
	if (!eventId.value)
		return;

	const deleteModal = overlay.create(LazyUIConfirmDeleteModal);
	const confirmed = await deleteModal.open({
		title: 'Delete Player',
		itemName: player.name,
	}).result;

	if (!confirmed)
		return;

	await runRequest(
		() => playerStore.removePlayer(eventId.value!, player.id),
		{
			success: { title: 'Player deleted', color: 'success' },
			error: { title: 'Failed to delete player', color: 'error' },
		},
	);
}

async function handleSyncSelectedRound() {
	if (!eventId.value || !selectedRound.value)
		return;

	await runRequest(
		async () => {
			const result = await meleeStore.syncSpecificRound(selectedRound.value!.id);
			if (!result.success)
				throw new Error(result.error ?? 'Failed to sync round');
			await Promise.all([
				roundStore.loadRoundsByEventId(eventId.value!),
				loadSelectedRoundStandings(),
			]);
			return true;
		},
		{
			success: { title: 'Round synced', description: `${selectedRound.value.name} standings loaded`, color: 'success' },
			error: ({ message }) => ({ title: 'Failed to sync round', description: message, color: 'error' }),
		},
	);
}

async function handleSendDeckToScreen(playerId: number, screenId?: number) {
	if (screenId) {
		const screen = screenStore.screens.find(s => s.id === screenId);
		if (screen)
			await sendDeckToScreen(playerId, screen);
	}
	else {
		await sendToFirstDeckScreen(playerId);
	}
}

async function handleSendMatchHistoryToScreen(playerId: number, screenId?: number) {
	if (screenId) {
		const screen = screenStore.screens.find(s => s.id === screenId);
		if (screen)
			await sendPlayerHistoryToScreen(playerId, screen);
	}
	else {
		await sendToFirstPlayerHistoryScreen(playerId);
	}
}

// ── List Membership Handlers ──

async function handleAddToList(listId: number, playerIds: number[]) {
	if (!eventId.value)
		return;
	await playerListStore.addMembers(eventId.value, listId, playerIds);
}

async function handleRemoveFromList(listId: number, playerIds: number[]) {
	if (!eventId.value)
		return;
	await playerListStore.batchRemoveMembers(eventId.value, listId, playerIds);
}

// ── Bulk Action Handlers ──

const bulkAddToListItems = computed<DropdownMenuItem[][]>(() => {
	const items = playerListStore.lists.map(list => ({
		label: list.name,
		icon: 'i-lucide-list' as const,
		onSelect: () => handleBulkAddToList(list.id),
	}));

	if (items.length === 0) {
		return [[{ label: 'No lists created', disabled: true }]];
	}

	return [items];
});

async function handleBulkAddToList(listId: number) {
	await handleAddToList(listId, selectedPlayerIds.value);
	playerList.value?.clearSelection();
}

async function handleBulkRemoveFromList() {
	if (activeListId.value !== null) {
		await handleRemoveFromList(activeListId.value, selectedPlayerIds.value);
		playerList.value?.clearSelection();
	}
}
</script>

<template>
	<UICollectionPage
		:state="pageState"
		flush
		content-width="full"
		empty-icon="i-lucide-users"
		empty-title="No players yet"
		empty-description="Create a player to get started."
	>
		<template #actions>
			<UButton
				icon="i-lucide-user-plus"
				@click="handleCreatePlayer"
			>
				Create Player
			</UButton>
		</template>

		<template #toolbar>
			<UDashboardToolbar>
				<template #left>
					<!-- Bulk actions (replaces tabs when selections are active) -->
					<div v-if="selectedPlayerIds.length > 0" class="flex items-center gap-3">
						<span class="text-sm font-medium">
							{{ selectedPlayerIds.length }} selected
						</span>

						<USeparator orientation="vertical" class="h-4" />

						<UDropdownMenu :items="bulkAddToListItems">
							<UButton
								variant="ghost"
								size="xs"
								icon="i-lucide-list-plus"
								label="Add to List"
							/>
						</UDropdownMenu>

						<UButton
							v-if="activeListId !== null"
							variant="ghost"
							size="xs"
							color="error"
							icon="i-lucide-list-minus"
							label="Remove from List"
							@click="handleBulkRemoveFromList"
						/>

						<UButton
							variant="ghost"
							size="xs"
							color="neutral"
							icon="i-lucide-x"
							label="Clear"
							@click="playerList?.clearSelection()"
						/>
					</div>

					<template v-else>
						<div class="flex items-center gap-3">
							<!-- Round selector (before list tabs) -->
							<USelectMenu
								v-if="hasRoundOptions"
								v-model="selectedRoundId"
								:items="roundOptions"
								value-key="value"
								placeholder="Current"
								class="w-56"
							/>

							<!-- List tabs -->
							<PlayerListTabs
								:lists="playerListStore.lists"
								:active-list-id="activeListId"
								:loading="playerStore.loading"
								@select="handleSelectList"
								@create-list="handleCreateList"
							/>
						</div>
					</template>
				</template>

				<template #right>
					<UISearchInput
						v-model="searchQuery"
						placeholder="Search by name or deck..."
						aria-label="Search players"
					/>
					<UButton
						v-if="activeListId !== null"
						variant="soft"
						size="sm"
						icon="i-lucide-pencil"
						label="Edit List"
						@click="handleEditList(activeListId!)"
					/>
				</template>
			</UDashboardToolbar>
		</template>

		<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

		<template v-else>
			<UAlert
				v-if="selectedRoundId && standingsMap && standingsMap.size === 0 && !standingsLoading"
				color="warning"
				variant="subtle"
				icon="i-lucide-info"
				title="No standings cached for this round"
				description="Showing current player standings. Sync this round to load round-specific standings from Melee."
				class="mb-4"
			>
				<template v-if="selectedRoundCanSync" #actions>
					<UButton
						size="sm"
						color="warning"
						variant="soft"
						icon="i-lucide-refresh-cw"
						:loading="meleeStore.syncingRound"
						@click="handleSyncSelectedRound"
					>
						Sync Round
					</UButton>
				</template>
			</UAlert>

			<UAlert
				v-if="standingsError"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-alert"
				:title="standingsError"
				class="mb-4"
			/>

			<PlayerList
				ref="playerList"
				:players="displayedPlayers"
				:loading="initialLoading || standingsLoading"
				:global-filter="globalFilter"
				:lists="playerListStore.lists"
				:active-list-id="activeListId"
				@add-to-list="handleAddToList"
				@remove-from-list="handleRemoveFromList"
				@edit-player="handleEditPlayer"
				@delete-player="handleDeletePlayer"
				@view-deck-list="openPlayerDeckList"
				@view-match-history="openPlayerMatchHistory"
				@send-deck-to-screen="handleSendDeckToScreen"
				@send-match-history-to-screen="handleSendMatchHistoryToScreen"
			/>
		</template>

		<template #empty-actions>
			<UButton icon="i-lucide-user-plus" @click="handleCreatePlayer">
				Create Player
			</UButton>
		</template>
	</UICollectionPage>
</template>
