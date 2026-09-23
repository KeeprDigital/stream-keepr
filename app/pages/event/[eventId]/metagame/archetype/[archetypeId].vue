<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { BoardSelection, MetagameCardSortBy } from '~~/shared/types/enums';
import type { ArchetypeDetailResponse } from '~~/shared/types/metagame';
import { useMetagameClient } from '~/modules/metagame/client';

type DetailSection = 'cards' | 'players';

const route = useRoute();
const router = useRouter();
const eventStore = useEventStore();
const playerStore = usePlayerStore();
const metagameStore = useMetagameStore();
const metagameClient = useMetagameClient();
const { openPlayerDeckList } = usePlayerDeckListModal();
const { runRequest } = useRequestFeedback();

const isMtg = computed(() => eventStore.event?.game === 'mtg');
const archetypeId = computed(() => Number(route.params.archetypeId));
const archetypeCardSortBy = ref<MetagameCardSortBy>('inclusionRate');
const archetypeCardBoardFilter = ref<BoardSelection>('full');

const detail = ref<ArchetypeDetailResponse | null>(null);
const loading = ref(false);

const hasCardsSection = computed(() => isMtg.value && detail.value != null);
const availableSections = computed<DetailSection[]>(() => {
	if (!detail.value)
		return [];

	const sections: DetailSection[] = [];
	if (hasCardsSection.value)
		sections.push('cards');
	sections.push('players');
	return sections;
});

const sectionTabs = computed<TabsItem[]>(() => availableSections.value.map(section => ({
	label: section === 'cards' ? 'Cards' : 'Players',
	value: section,
})));

const showSectionTabs = computed(() => availableSections.value.length > 1);

function parseSectionTab(tab: unknown): DetailSection | null {
	const value = Array.isArray(tab) ? tab[0] : tab;
	return value === 'cards' || value === 'players' ? value : null;
}

const requestedSection = computed(() => parseSectionTab(route.query.tab));
const activeSection = ref<DetailSection | null>(null);

function syncActiveSection(sections = availableSections.value, requested = requestedSection.value) {
	if (sections.length === 0) {
		activeSection.value = null;
		return null;
	}

	const nextSection = requested && sections.includes(requested)
		? requested
		: sections[0] ?? null;

	if (!nextSection) {
		activeSection.value = null;
		return null;
	}

	activeSection.value = nextSection;
	return nextSection;
}

async function setActiveSection(section: string | number) {
	if (section !== 'cards' && section !== 'players')
		return;
	if (!availableSections.value.includes(section))
		return;
	if (activeSection.value === section)
		return;

	await router.replace({
		query: {
			...route.query,
			tab: section,
		},
	});
}

// ── Stat strip ──
const conversionLabel = computed(() => metagameStore.conversionMetric === 'topN'
	? `Top ${metagameStore.conversionThreshold}`
	: `${metagameStore.conversionThreshold}+ pts`);

const stats = computed(() => {
	if (!detail.value)
		return [];
	return [
		{ label: 'Players', value: detail.value.playerCount },
		{ label: 'Meta Share', value: detail.value.metaShare != null ? `${detail.value.metaShare}%` : null },
		{ label: 'Win Rate', value: detail.value.winRate != null ? `${detail.value.winRate}%` : null },
		{ label: 'Avg Place', value: detail.value.avgPosition },
		{
			label: `Conversion (${conversionLabel.value})`,
			value: detail.value.conversionRate != null && detail.value.convertedCount != null
				? `${detail.value.conversionRate}% (${detail.value.convertedCount}/${detail.value.playerCount})`
				: null,
		},
	];
});

// ── Fetch ──
async function fetchDetail() {
	if (!eventStore.eventId || !archetypeId.value)
		return;
	await runRequest(
		() => metagameClient.loadArchetypeDetail(
			eventStore.eventId!,
			archetypeId.value,
			metagameStore.scopeQuery,
			{ board: archetypeCardBoardFilter.value, ...metagameStore.conversionQuery },
		),
		{
			latestKey: 'detail',
			loadingRef: loading,
			success: false,
			error: { title: 'Failed to load archetype details', color: 'error' },
			onSuccess: (data) => {
				detail.value = data;
				syncActiveSection();
			},
			onFailure: () => {
				detail.value = null;
				syncActiveSection([]);
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
		() => archetypeId.value,
		() => metagameStore.scope,
		() => metagameStore.topN,
		() => metagameStore.minPoints,
		() => metagameStore.playerListId,
		() => metagameStore.conversionMetric,
		() => metagameStore.conversionThreshold,
		() => archetypeCardBoardFilter.value,
		() => metagameStore.invalidationVersion,
	],
	() => fetchDetail(),
	{ immediate: true },
);

watch(
	[availableSections, requestedSection],
	async ([sections, requested]) => {
		const nextSection = syncActiveSection(sections, requested);
		if (!nextSection)
			return;

		if (nextSection !== requested) {
			await router.replace({
				query: {
					...route.query,
					tab: nextSection,
				},
			});
		}
	},
	{ immediate: true },
);
</script>

<template>
	<UILoadingSpinner v-if="loading && !detail" />

	<UIEmptyState
		v-else-if="!detail && !loading"
		icon="i-lucide-alert-triangle"
		title="Archetype not found"
		description="This archetype could not be loaded for the current scope."
	/>

	<div v-else-if="detail" class="flex flex-col gap-6">
		<!-- Hero card -->
		<UCard>
			<div class="flex flex-col gap-6">
				<div class="flex items-center gap-3">
					<h2 class="text-2xl font-bold">
						{{ detail.name }}
					</h2>
					<MtgManaColorDisplay
						v-if="isMtg && detail.colors"
						:colors="detail.colors"
						size="lg"
						:cost="true"
					/>
				</div>
				<MetagameStatStrip :stats="stats" />
			</div>
		</UCard>

		<!-- Key Cards (MTG only) -->
		<UCard v-if="isMtg && detail.keyCards.length > 0">
			<template #header>
				<h3 class="text-base font-semibold">
					Key Cards
				</h3>
			</template>
			<MetagameKeyCards
				:cards="detail.keyCards"
				:event-id="eventStore.eventId!"
			/>
		</UCard>

		<UISegmentedTabs
			v-if="showSectionTabs"
			:items="sectionTabs"
			:model-value="activeSection ?? undefined"
			@update:model-value="value => value !== undefined && setActiveSection(value)"
		/>

		<!-- Card Breakdown (MTG only) -->
		<MetagameCardsTable
			v-if="hasCardsSection"
			v-show="activeSection === 'cards'"
			:entries="detail.cardBreakdown"
			:sort-by="archetypeCardSortBy"
			:board-filter="archetypeCardBoardFilter"
			:show-deck-count="false"
			:get-row-link="entry => `/event/${eventStore.eventId}/metagame/card/${entry.id}`"
			@update:sort-by="archetypeCardSortBy = $event"
			@update:board-filter="archetypeCardBoardFilter = $event"
		/>

		<!-- Players -->
		<MetagamePlayersTable
			v-show="activeSection === 'players'"
			:players="detail.players"
			title="Players"
			empty-message="No players in this archetype for the current scope"
			@view-deck-list="openPlayerDeckList"
		/>
	</div>
</template>
