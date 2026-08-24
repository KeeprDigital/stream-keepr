<script setup lang="ts">
import type { BoardSelection, MetagameCardSortBy } from '~~/shared/types/enums';
import type { CardBreakdownEntry, CardBreakdownResponse } from '~~/shared/types/metagame';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { useMetagameClient } from '~/modules/metagame/client';

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const metagameStore = useMetagameStore();
const metagameClient = useMetagameClient();
const { runRequest } = useRequestFeedback();

const cardData = ref<CardBreakdownResponse | null>(null);
const cardLoading = ref(false);
const cardSortBy = ref<MetagameCardSortBy>('inclusionRate');
const cardBoardFilter = ref<BoardSelection>('full');

const hasDeckData = computed(() => playerStore.players.some(p => getMtgGameData(p.gameData).deckName));

function cardRowLink(entry: CardBreakdownEntry) {
	return `/event/${eventStore.eventId}/metagame/card/${entry.id}`;
}

async function fetchCards() {
	await runRequest(
		() => metagameClient.loadCardBreakdown(
			eventStore.eventId!,
			metagameStore.scopeQuery,
			{ sortBy: cardSortBy.value, limit: 100, board: cardBoardFilter.value },
		),
		{
			latestKey: 'cards',
			loadingRef: cardLoading,
			success: false,
			error: { title: 'Failed to load card data', color: 'error' },
			onSuccess: (data) => {
				cardData.value = data;
			},
			onFailure: () => {
				cardData.value = null;
			},
		},
	);
}

const { summaryLoading, fetchPageData } = useMetagamePage(fetchCards);

const { initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
], fetchPageData);

watch([cardSortBy, cardBoardFilter], () => fetchCards());
</script>

<template>
	<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

	<UILoadingSpinner v-else-if="initialLoading" />

	<div v-else class="flex flex-col gap-6">
		<MetagameSummaryPanel
			:summary="metagameStore.summaryData"
			:loading="summaryLoading"
		/>

		<UIEmptyState
			v-if="!hasDeckData"
			icon="i-lucide-layers"
			title="No deck data available"
			description="Sync deck lists from Melee or add deck info manually."
		/>

		<MetagameCardsTable
			v-else
			:entries="cardData?.entries ?? []"
			:total-decks="cardData?.totalDecks ?? 0"
			:loading="cardLoading"
			:sort-by="cardSortBy"
			:board-filter="cardBoardFilter"
			:get-row-link="cardRowLink"
			@update:sort-by="cardSortBy = $event"
			@update:board-filter="cardBoardFilter = $event"
		/>
	</div>
</template>
