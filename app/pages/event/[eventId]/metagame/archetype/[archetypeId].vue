<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { BoardSelection, MetagameCardSortBy } from '~~/shared/types/enums';
import type { ArchetypeDetailResponse } from '~~/shared/types/metagame';
import { getMetagameRules } from '~~/shared/config/games';
import { conversionTargetLabel } from '~~/shared/conversionTarget';
import { useConsumedEventData } from '~/modules/event-data/resync';
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
const playerDeckStore = usePlayerDeckStore();
const { mergeInto } = useArchetypeManagement(() => eventStore.eventId!, () => Number(route.params.archetypeId));

const game = computed(() => eventStore.event?.game);
const isMtg = computed(() => game.value === 'mtg');
// An OP Metagame reads participation only (ADR-0074).
const readsStandings = computed(() => !game.value || getMetagameRules(game.value).readsStandings);
const archetypeId = computed(() => Number(route.params.archetypeId));
const archetypeCardSortBy = ref<MetagameCardSortBy>('inclusionRate');
const archetypeCardBoardFilter = ref<BoardSelection>('full');

const detail = ref<ArchetypeDetailResponse | null>(null);
const loading = ref(false);

const hasCardsSection = computed(() => detail.value != null);
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
	label: section === 'cards'
		? 'Cards'
		: 'Players',
	value: section,
})));

const showSectionTabs = computed(() => availableSections.value.length > 1);

function parseSectionTab(tab: unknown): DetailSection | null {
	const value = Array.isArray(tab)
		? tab[0]
		: tab;
	return value === 'cards' || value === 'players'
		? value
		: null;
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

/** Opens Archetype Review on the deck the Player holds in this Archetype: they can hold several. */
function reviewDeck(player: { id: number }) {
	const held = playerDeckStore.decks.filter(deck => deck.playerId === player.id && deck.archetypeId === archetypeId.value);
	const deck = held.find(candidate => candidate.isPrimary) ?? held[0];
	void navigateTo(deck
		? `/event/${eventStore.eventId}/archetype-review?deckId=${deck.id}`
		: `/event/${eventStore.eventId}/archetype-review`);
}

// ── Stat strip ──
const conversionLabel = computed(() => conversionTargetLabel(metagameStore.conversionTarget));

const stats = computed(() => {
	if (!detail.value)
		return [];
	const participation = [
		{ label: 'Players', value: detail.value.playerCount },
		{
			label: 'Meta Share',
			value: detail.value.metaShare != null
				? `${detail.value.metaShare}%`
				: null,
		},
	];
	if (!readsStandings.value)
		return participation;
	return [
		...participation,
		{
			label: 'Win Rate',
			value: detail.value.winRate != null
				? `${detail.value.winRate}%`
				: null,
		},
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
			{ board: archetypeCardBoardFilter.value, ...metagameStore.conversionTarget },
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

useConsumedEventData(['players']);

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
		() => metagameStore.conversionTarget.conversionMetric,
		() => metagameStore.conversionTarget.conversionThreshold,
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
					<MetagameArchetypeColors
						v-if="detail.colors"
						:colors="detail.colors"
						:game="game"
						size="lg"
					/>
				</div>
				<MetagameStatStrip :stats="stats" />
				<!--
					A rename changes the Archetype for every Deck List it holds. On MTG a name another
					Archetype holds is offered as a merge; on OP a rename customises a Leader Archetype (ADR-0074).
				-->
				<MetagameArchetypeNameField
					:event-id="eventStore.eventId!"
					:archetype-id="detail.id"
					:mergeable="isMtg"
					@merge="mergeInto"
				/>
				<MetagameArchetypeChartSeriesField
					:event-id="eventStore.eventId!"
					:archetype-id="detail.id"
				/>
				<MetagameArchetypeActions
					v-if="isMtg"
					:event-id="eventStore.eventId!"
					:archetype-id="detail.id"
				/>
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

		<!-- Card Breakdown -->
		<MetagameCardsTable
			v-if="hasCardsSection"
			v-show="activeSection === 'cards'"
			:entries="detail.cardBreakdown"
			:sort-by="archetypeCardSortBy"
			:board-filter="archetypeCardBoardFilter"
			:show-deck-count="false"
			:game="game"
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
			:reviewable="isMtg"
			@view-deck-list="openPlayerDeckList"
			@review-deck="reviewDeck"
		/>
	</div>
</template>
