<script setup lang="ts">
import type { TokenRequirementsResponse, TokenSourceCardEntry } from '~~/shared/types/metagame';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { useMetagameClient } from '~/modules/metagame/client';

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const metagameStore = useMetagameStore();
const metagameClient = useMetagameClient();
const { runRequest } = useRequestFeedback();

const tokenData = ref<TokenRequirementsResponse | null>(null);
const tokenLoading = ref(false);

const hasDeckData = computed(() => playerStore.players.some(p => getMtgGameData(p.gameData).deckName));

function sourceCardLink(card: TokenSourceCardEntry) {
	return `/event/${eventStore.eventId}/metagame/card/${card.id}`;
}

async function fetchTokens() {
	await runRequest(
		() => metagameClient.loadTokenRequirements(
			eventStore.eventId!,
			metagameStore.scopeQuery,
		),
		{
			latestKey: 'tokens',
			loadingRef: tokenLoading,
			success: false,
			error: { title: 'Failed to load token data', color: 'error' },
			onSuccess: (data) => {
				tokenData.value = data;
			},
			onFailure: () => {
				tokenData.value = null;
			},
		},
	);
}

const { summaryLoading, fetchPageData } = useMetagamePage(fetchTokens);

const { initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
], fetchPageData);
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

		<MetagameTokensTable
			v-else
			:entries="tokenData?.entries ?? []"
			:total-decks="tokenData?.totalDecks ?? 0"
			:loading="tokenLoading"
			:get-source-card-link="sourceCardLink"
		/>
	</div>
</template>
