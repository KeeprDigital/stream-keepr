<script setup lang="ts">
import type { MetagameSortBy } from '~~/shared/types/enums';
import type { ArchetypeBreakdownResponse } from '~~/shared/types/metagame';
import type { MetagameAdminView } from '~/components/Metagame/ViewToggle.vue';
import { useMetagameClient } from '~/modules/metagame/client';

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const archetypeStore = useArchetypeStore();
const metagameStore = useMetagameStore();
const metagameClient = useMetagameClient();
const { runRequest } = useRequestFeedback();

const isMtg = computed(() => eventStore.event?.game === 'mtg');
const archetypeView = ref<MetagameAdminView>('table');
const archetypeSortBy = ref<MetagameSortBy>('metaShare');

const archetypeData = ref<ArchetypeBreakdownResponse | null>(null);
const archetypeLoading = ref(false);

// ── Computed ──
const hasPlayers = computed(() => playerStore.players.length > 0);
const classifiedPlayersInScope = computed(() => archetypeData.value?.classifiedPlayers ?? 0);

// ── Fetch ──
async function fetchArchetypes() {
	await runRequest(
		() => metagameClient.loadArchetypeBreakdown(
			eventStore.eventId!,
			metagameStore.scopeQuery,
			{ sortBy: archetypeSortBy.value },
		),
		{
			latestKey: 'archetypes',
			loadingRef: archetypeLoading,
			success: false,
			error: { title: 'Failed to load archetype data', color: 'error' },
			onSuccess: (data) => {
				archetypeData.value = data;
			},
			onFailure: () => {
				archetypeData.value = null;
			},
		},
	);
}

const { summaryLoading, fetchPageData } = useMetagamePage(fetchArchetypes, {
	extraScopeWatchSources: [archetypeSortBy],
});

function onArchetypeSelect(archetypeName: string | null) {
	if (!archetypeName)
		return;
	const entry = archetypeData.value?.entries.find(e => e.name === archetypeName);
	if (!entry)
		return;
	void navigateTo(`/event/${eventStore.eventId}/metagame/archetype/${entry.id}`);
}

// ── Initialization ──
const { eventId, initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
	{ isLoaded: () => archetypeStore.isLoaded, load: id => archetypeStore.loadByEventId(id) },
], fetchPageData);
</script>

<template>
	<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

	<UILoadingSpinner v-else-if="initialLoading" />

	<UIEmptyState
		v-else-if="!hasPlayers"
		icon="i-lucide-users"
		title="No players in this event"
		description="Add or sync players first."
	/>

	<div v-else class="flex flex-col gap-6">
		<MetagameSummaryPanel
			:summary="metagameStore.summaryData"
			:loading="summaryLoading"
		/>

		<!-- Archetype card -->
		<UCard :ui="{ body: 'p-0 sm:p-0' }">
			<template #header>
				<div class="flex items-center justify-between">
					<h3 class="text-base font-semibold">
						Archetype Breakdown
					</h3>
					<div class="flex items-center gap-3">
						<MetagameViewToggle v-if="classifiedPlayersInScope > 0" v-model="archetypeView" />
					</div>
				</div>
			</template>

			<UIEmptyState
				v-if="isMtg && classifiedPlayersInScope === 0 && !archetypeLoading"
				variant="inline"
				icon="i-lucide-tags"
				title="No archetypes classified yet"
				description="Review player decks to classify them into archetypes."
			>
				<template #actions>
					<UButton
						icon="i-lucide-tags"
						color="primary"
						variant="outline"
						:to="`/event/${eventId}/archetype-review`"
					>
						Review Archetypes
					</UButton>
				</template>
			</UIEmptyState>

			<template v-else>
				<MetagameArchetypeTable
					v-if="archetypeView === 'table'"
					:entries="archetypeData?.entries ?? []"
					:total-players="archetypeData?.totalPlayers ?? 0"
					:loading="archetypeLoading"
					:is-mtg="isMtg"
					:archetypes="archetypeStore.archetypes"
					:sort-by="archetypeSortBy"
					@update:sort-by="archetypeSortBy = $event"
					@select="onArchetypeSelect"
				/>
				<MetagameArchetypeBarChart
					v-else-if="archetypeView === 'bar'"
					:entries="archetypeData?.entries ?? []"
					:total-players="archetypeData?.totalPlayers ?? 0"
					:loading="archetypeLoading"
					@select="onArchetypeSelect"
				/>
			</template>
		</UCard>
	</div>
</template>
