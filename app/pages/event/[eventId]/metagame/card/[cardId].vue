<script setup lang="ts">
import type { CardDetailResponse } from '~~/shared/types/metagame';
import { getPointEntryByOracleId } from '~~/shared/utils/highlander';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';
import { useMetagameClient } from '~/modules/metagame/client';

const route = useRoute();
const eventStore = useEventStore();
const playerStore = usePlayerStore();
const metagameStore = useMetagameStore();
const metagameClient = useMetagameClient();
const { openPlayerDeckList } = usePlayerDeckListModal();
const { runRequest } = useRequestFeedback();

const cardId = computed(() => Number(route.params.cardId));

const detail = ref<CardDetailResponse | null>(null);
const loading = ref(false);

const cardPointEntry = computed(() => {
	const pointsSystem = eventStore.event?.pointsSystem;
	const oracleId = detail.value?.card.oracleId;
	if (!pointsSystem || !oracleId) {
		return null;
	}

	return getPointEntryByOracleId(pointsSystem, oracleId);
});

// ── Usage stats ──
const usageStats = computed(() => {
	if (!detail.value)
		return [];
	const d = detail.value;
	return [
		{ label: 'Inclusion Rate', value: d.inclusionRate != null ? `${d.inclusionRate}%` : null },
		{ label: 'Avg Copies', value: d.avgCopies },
		{ label: 'Total Decks', value: d.totalDecks },
		{ label: 'Archetypes', value: d.archetypes.length },
		{ label: 'Mainboard', value: d.mainboardCount },
		{ label: 'Sideboard', value: d.sideboardCount },
	];
});

// ── Fetch ──
async function fetchDetail() {
	if (!eventStore.eventId || !cardId.value)
		return;
	await runRequest(
		() => metagameClient.loadCardDetail(
			eventStore.eventId!,
			cardId.value,
			metagameStore.scopeQuery,
		),
		{
			latestKey: 'detail',
			loadingRef: loading,
			success: false,
			error: { title: 'Failed to load card details', color: 'error' },
			onSuccess: (data) => {
				detail.value = data;
			},
			onFailure: () => {
				detail.value = null;
			},
		},
	);
}

watch(() => eventStore.eventId, async (eventId) => {
	if (eventId && !playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(eventId);
	}
}, { immediate: true });

watch(
	[
		() => cardId.value,
		() => metagameStore.scope,
		() => metagameStore.topN,
		() => metagameStore.playerListId,
		() => metagameStore.invalidationVersion,
	],
	() => fetchDetail(),
	{ immediate: true },
);
</script>

<template>
	<UILoadingSpinner v-if="loading && !detail" />

	<UIEmptyState
		v-else-if="!detail && !loading"
		icon="i-lucide-alert-triangle"
		title="Card not found"
		description="This card could not be loaded for the current scope."
	/>

	<div v-else-if="detail" class="flex flex-col gap-6">
		<!-- Hero: card image + info + usage stats -->
		<UCard>
			<div class="flex gap-8 items-start">
				<MetagameCardThumbnail
					:scryfall-id="detail.card.scryfallId"
					:name="detail.card.name"
					size="lg"
					class="flex-shrink-0"
				/>
				<div class="flex flex-col gap-4 min-w-0">
					<div class="flex flex-col gap-2">
						<h2 class="text-2xl font-bold">
							{{ detail.card.name }}
						</h2>
						<div class="flex items-center gap-3 text-sm text-muted flex-wrap">
							<span v-if="detail.card.cardType">{{ getCardTypeDisplayLabel(detail.card.cardType, { nonbasicLandLabel: true }) }}</span>
							<UBadge v-if="cardPointEntry" color="neutral" variant="soft">
								{{ cardPointEntry.points }} Points
							</UBadge>
							<UBadge v-if="cardPointEntry?.pointedAs === 'companion'" color="neutral" variant="outline">
								Companion
							</UBadge>
							<MtgManaColorDisplay
								v-if="detail.card.manaCost"
								:mana-cost="detail.card.manaCost"
								size="sm"
							/>
						</div>
					</div>
					<MetagameStatStrip :stats="usageStats" />
				</div>
			</div>
		</UCard>

		<!-- Archetypes playing this card -->
		<MetagameCardArchetypesTable
			v-if="detail.archetypes.length > 0"
			:archetypes="detail.archetypes"
		/>

		<!-- Co-occurrence -->
		<MetagameCardCoOccurrenceTable
			v-if="detail.coOccurrence.length > 0"
			:entries="detail.coOccurrence"
		/>

		<!-- Players -->
		<MetagamePlayersTable
			:players="detail.players"
			title="Players Running This Card"
			empty-message="No players running this card in the current scope"
			show-copies
			@view-deck-list="openPlayerDeckList"
		/>
	</div>
</template>
