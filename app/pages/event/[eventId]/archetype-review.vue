<script setup lang="ts">
definePageMeta({
	title: 'Archetype Review',
	layout: false,
});

const route = useRoute();
const router = useRouter();
const eventStore = useEventStore();
const playerStore = usePlayerStore();
const archetypeStore = useArchetypeStore();
const playerDeckStore = usePlayerDeckStore();

const eventId = computed(() => eventStore.eventId);

const {
	eventId: loadedEventId,
	initialLoading,
	initialError,
	retry,
} = useEventPageLoading([
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
	{ isLoaded: () => archetypeStore.isLoaded, load: id => archetypeStore.loadByEventId(id) },
	{ isLoaded: () => playerDeckStore.isLoaded, load: id => playerDeckStore.loadByEventId(id) },
]);

// ── Queue ──

const {
	queueFilter,
	currentIndex,
	currentEntry,
	activeDeck,
	deckLoading,
	allEntries,
	filteredCount,
	totalDecks,
	reviewedCount,
	progressPercent,
	archetypePlayerCounts,
	advance,
	goBack,
	jumpToDeck,
	prepareAdvance,
} = useArchetypeReviewQueue();

function handleJumpToDeck(deckId: number) {
	if (!jumpToDeck(deckId) || !loadedEventId.value)
		return;
	void router.replace({ path: `/event/${loadedEventId.value}/archetype-review`, query: { deckId: String(deckId) } });
}

watch([initialLoading, allEntries, () => route.query.deckId], ([loading]) => {
	if (loading)
		return;
	const rawDeckId = Array.isArray(route.query.deckId) ? route.query.deckId[0] : route.query.deckId;
	const deckId = rawDeckId ? Number(rawDeckId) : null;
	if (deckId && Number.isFinite(deckId)) {
		jumpToDeck(deckId);
	}
}, { immediate: true });

// ── Assignment ──

const {
	nameInput,
	colorsInput,
	selectedKeyCards,
	saving,
	isEditMode,
	matchesExistingArchetype,
	matchingArchetypeId,
	isNameValid,
	buttonLabel,
	archetypeKeyCardMatches,
	sortedArchetypes,
	toggleKeyCard,
	acceptName,
	handleChipClick,
} = useArchetypeAssignment({
	currentEntry,
	activeDeck,
	eventId,
	prepareAdvance,
	archetypePlayerCounts,
});
</script>

<template>
	<NuxtLayout name="default" flush>
		<template #toolbar>
			<ArchetypeReviewToolbar
				:current-index="currentIndex"
				:filtered-count="filteredCount"
				:queue-filter="queueFilter"
				:reviewed-count="reviewedCount"
				:total-decks="totalDecks"
				:progress-percent="progressPercent"
				:initial-loading="initialLoading"
				:entries="allEntries"
				:selected-deck-id="currentEntry?.deck.id ?? null"
				@update:queue-filter="queueFilter = $event"
				@jump-to-deck="handleJumpToDeck"
				@back="goBack()"
				@advance="advance()"
			/>
		</template>

		<!-- Loading -->
		<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

		<UILoadingSpinner v-else-if="initialLoading" />

		<!-- Empty state: no MTG decks at all -->
		<UIEmptyState
			v-else-if="totalDecks === 0"
			icon="i-lucide-layers"
			title="No MTG decks to review"
			description="Sync player data from Melee first."
		>
			<template #actions>
				<UButton
					color="neutral"
					variant="outline"
					:to="`/event/${loadedEventId}/metagame`"
				>
					Back to Metagame
				</UButton>
			</template>
		</UIEmptyState>

		<!-- Empty filtered queue -->
		<UIEmptyState
			v-else-if="filteredCount === 0"
			icon="i-lucide-check-circle"
			:title="queueFilter === 'unreviewed' ? 'All decks reviewed!' : 'No decks match this filter.'"
			:description="`${reviewedCount} / ${totalDecks} decks assigned to archetypes.`"
		>
			<template #actions>
				<div class="flex items-center gap-2">
					<UButton
						v-if="queueFilter === 'unreviewed'"
						color="primary"
						variant="outline"
						:to="`/event/${loadedEventId}/metagame`"
					>
						View Metagame
					</UButton>
					<UButton
						v-if="queueFilter !== 'all'"
						color="neutral"
						variant="outline"
						@click="() => { queueFilter = 'all' }"
					>
						Show All Decks
					</UButton>
				</div>
			</template>
		</UIEmptyState>

		<!-- Main review UI -->
		<div v-else-if="currentEntry" class="flex h-full flex-col xl:flex-row">
			<ArchetypeReviewDeckPanel
				:entry="currentEntry"
				:active-deck="activeDeck"
				:loading="saving || deckLoading"
				:selected-key-cards="selectedKeyCards"
				@toggle-key-card="toggleKeyCard"
			/>

			<ArchetypeReviewAssignmentPanel
				:name-input="nameInput"
				:colors-input="colorsInput"
				:saving="saving"
				:is-edit-mode="isEditMode"
				:is-name-valid="isNameValid"
				:matches-existing-archetype="matchesExistingArchetype"
				:matching-archetype-id="matchingArchetypeId"
				:button-label="buttonLabel"
				:sorted-archetypes="sortedArchetypes"
				:archetype-player-counts="archetypePlayerCounts"
				:archetype-key-card-matches="archetypeKeyCardMatches"
				:entry-id="currentEntry.deck.id"
				@update:name-input="nameInput = $event"
				@update:colors-input="colorsInput = $event"
				@accept="acceptName"
				@chip-click="handleChipClick"
			/>
		</div>
	</NuxtLayout>
</template>
