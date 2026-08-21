<script setup lang="ts">
import type { PlayerDeckCardEntry, PlayerDeckResponse } from '~~/shared/types/metagame';
import type { ReviewEntry } from '~/composables/workflows/useArchetypeReviewQueue';
import type { MtgCard } from '~/types/card/mtg';
import { useElementSize } from '@vueuse/core';
import { getDeckColumnCount, splitDeckGroupsIntoColumns } from '~~/shared/utils/deckColumns';
import { calculateDeckCurve, calculateDeckPips, calculateDeckStats, formatPips, formatStats } from '~~/shared/utils/deckStats';
import { formatHighlanderIssueSummary, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';
import { createDeckLookupCards, getDeckCardImageUrl, isReviewedPlayerDeck } from '~~/shared/utils/playerDeck';

const props = defineProps<{
	entry: ReviewEntry | null;
	activeDeck: PlayerDeckResponse | null;
	loading?: boolean;
	selectedKeyCards: Set<string>;
}>();

const emit = defineEmits<{
	(e: 'toggleKeyCard', name: string): void;
}>();

// ── View mode ──

const viewMode = ref<'list' | 'grid'>('list');

// ── Scryfall card data ──

const { fetchScryfallCards } = useScryfallBatch();
const cardDataMap = shallowRef(new Map<string, MtgCard>());

watch(() => props.activeDeck, async (deck) => {
	cardDataMap.value = new Map();
	if (!deck)
		return;
	const lookupCards = createDeckLookupCards(deck.cards, deck.companion);
	cardDataMap.value = (await fetchScryfallCards(lookupCards)).cards;
}, { immediate: true });

function getCardImageUrl(card: PlayerDeckCardEntry): string | null {
	return getDeckCardImageUrl(cardDataMap.value, card);
}

function getCompanionImageUrl() {
	if (!props.activeDeck?.companion) {
		return null;
	}

	const companion = props.activeDeck.companion;
	return getDeckCardImageUrl(cardDataMap.value, companion);
}

function getCompanionPreviewKey() {
	return props.activeDeck?.companion ? `companion-${props.activeDeck.companion.name}` : 'companion';
}

const cards = computed(() => props.activeDeck?.cards ?? []);

const highlanderImageUrlsByCardName = computed<Record<string, string | null>>(() => {
	const imageUrls: Record<string, string | null> = {};
	for (const card of cards.value) {
		imageUrls[card.name] = getCardImageUrl(card);
	}
	if (props.activeDeck?.companion) {
		imageUrls[props.activeDeck.companion.name] = getCompanionImageUrl();
	}
	return imageUrls;
});

// ── Card preview ──

const {
	activePreviewCard,
	handlePreviewUpdate,
	togglePreviewPin,
	resetPreview,
} = useCardPreview();

// Reset preview when navigating to a new submitted deck.
watch(() => props.entry?.deck.id, () => {
	resetPreview();
});

// ── Deck card computeds ──

const {
	mainboardCards,
	sideboardCards,
	mainboardTotal,
	sideboardTotal,
	mainboardByType,
	sideboardByType,
} = useDeckCardGroups(cards);

const DECK_TYPE_COLUMN_GAP = 24;
const REVIEW_DECK_TYPE_MIN_COLUMN_WIDTH = 240;

const mainboardGroupContainer = ref<HTMLElement | null>(null);
const sideboardGroupContainer = ref<HTMLElement | null>(null);
const { width: mainboardGroupWidth } = useElementSize(mainboardGroupContainer);
const { width: sideboardGroupWidth } = useElementSize(sideboardGroupContainer);

const mainboardGroups = computed(() => [...mainboardByType.value.entries()]);
const sideboardGroups = computed(() => [...sideboardByType.value.entries()]);

function getDeckTypeGridStyle(columnCount: number) {
	return {
		gridTemplateColumns: `repeat(${Math.max(columnCount, 1)}, minmax(0, 1fr))`,
		columnGap: `${DECK_TYPE_COLUMN_GAP}px`,
	};
}

const mainboardColumnCount = computed(() =>
	getDeckColumnCount(
		mainboardGroupWidth.value,
		REVIEW_DECK_TYPE_MIN_COLUMN_WIDTH,
		DECK_TYPE_COLUMN_GAP,
		mainboardGroups.value.length,
	),
);

const sideboardColumnCount = computed(() =>
	getDeckColumnCount(
		sideboardGroupWidth.value,
		REVIEW_DECK_TYPE_MIN_COLUMN_WIDTH,
		DECK_TYPE_COLUMN_GAP,
		sideboardGroups.value.length,
	),
);

const mainboardColumns = computed(() =>
	splitDeckGroupsIntoColumns(mainboardGroups.value, mainboardColumnCount.value),
);

const sideboardColumns = computed(() =>
	splitDeckGroupsIntoColumns(sideboardGroups.value, sideboardColumnCount.value),
);

const mainboardGridStyle = computed(() => getDeckTypeGridStyle(mainboardColumns.value.length));
const sideboardGridStyle = computed(() => getDeckTypeGridStyle(sideboardColumns.value.length));

const curveData = computed(() => calculateDeckCurve(mainboardCards.value));
const deckStats = computed(() =>
	mainboardCards.value.length ? calculateDeckStats(mainboardCards.value) : null,
);
const pipData = computed(() => formatPips(calculateDeckPips(cards.value)));
</script>

<template>
	<div class="flex-1 min-w-0 flex flex-col overflow-hidden">
		<!-- Sticky deck header -->
		<div class="shrink-0 bg-default border-b border-default px-4 py-2">
			<div class="flex-1 min-w-0">
				<div class="mb-1 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
					<div class="min-w-0 flex-1">
						<p v-if="entry" class="mb-0.5 truncate text-sm font-medium text-muted">
							{{ entry.player.name }}
						</p>
						<div class="flex items-center gap-3 min-w-0">
							<h2 class="text-xl font-bold truncate">
								{{ entry?.displayName ?? 'Unknown' }}
							</h2>
							<MtgManaColorDisplay
								v-if="entry?.displayColors"
								:colors="entry.displayColors"
								size="sm"
							/>
							<div v-if="activeDeck?.companion" class="flex items-center gap-2 min-w-0">
								<span class="text-xs uppercase tracking-wide text-muted shrink-0">Companion</span>
								<CardHoverPreview
									:image-url="getCompanionImageUrl()"
									:alt="activeDeck.companion.name"
									:is-active="activePreviewCard === getCompanionPreviewKey()"
									@preview="(open: boolean) => handlePreviewUpdate(getCompanionPreviewKey(), open)"
									@pin="togglePreviewPin(getCompanionPreviewKey())"
								>
									<span class="font-medium truncate">{{ activeDeck.companion.name }}</span>
								</CardHoverPreview>
							</div>
							<UBadge
								v-if="activeDeck?.highlander"
								color="neutral"
								variant="soft"
								size="sm"
								class="px-3 py-1 text-sm font-semibold"
							>
								{{ formatHighlanderPointsLabel(activeDeck.highlander) }}
							</UBadge>
							<UBadge
								v-if="activeDeck?.highlander && activeDeck.highlander.status !== 'legal'"
								:color="activeDeck.highlander.status === 'unknown' ? 'warning' : 'error'"
								variant="subtle"
								size="xs"
							>
								{{ activeDeck?.highlander?.status === 'unknown' ? 'Unknown' : `Illegal: ${activeDeck?.highlander ? formatHighlanderIssueSummary(activeDeck.highlander) : ''}` }}
							</UBadge>
							<UBadge
								v-if="entry && isReviewedPlayerDeck(entry.deck)"
								color="success"
								variant="subtle"
								size="xs"
							>
								Reviewed
							</UBadge>
						</div>
					</div>

					<!-- View toggles -->
					<UFieldGroup size="xs" class="shrink-0">
						<UButton
							icon="i-lucide-align-justify"
							label="List"
							:color="viewMode === 'list' ? 'primary' : 'neutral'"
							:variant="viewMode === 'list' ? 'soft' : 'outline'"
							@click="() => { viewMode = 'list' }"
						/>
						<UButton
							icon="i-lucide-grid-2x2"
							label="Grid"
							:color="viewMode === 'grid' ? 'primary' : 'neutral'"
							:variant="viewMode === 'grid' ? 'soft' : 'outline'"
							@click="() => { viewMode = 'grid' }"
						/>
					</UFieldGroup>
				</div>

				<!-- Type breakdown stats + pip counts -->
				<div v-if="deckStats || pipData.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<template v-if="deckStats">
						<span v-for="stat in formatStats(deckStats)" :key="stat.type">
							<span class="font-medium text-default me-1">{{ stat.count }}</span>
							<span class="text-muted">{{ stat.type }}</span>
						</span>
					</template>
					<span v-if="deckStats && pipData.length > 0" class="text-muted select-none">·</span>
					<div
						v-for="pip in pipData"
						:key="pip.color"
						class="flex items-center gap-0.5"
					>
						<MtgManaColorDisplay :colors="pip.color" size="sm" />
						<span class="font-mono text-xs text-muted ml-0.5">{{ pip.count }}</span>
					</div>
				</div>

				<MtgHighlanderSummary :highlander="activeDeck?.highlander" :image-urls-by-card-name="highlanderImageUrlsByCardName" class="mt-3" />
			</div>
		</div>

		<!-- Scrollable deck content -->
		<div class="relative flex-1 overflow-y-auto p-6">
			<div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-default/80 backdrop-blur-[2px] pointer-events-none">
				<div class="rounded-lg border border-default bg-elevated/95 px-4 py-3 shadow-sm">
					<UILoadingSpinner size="sm" label="Loading next deck..." />
				</div>
			</div>
			<div v-if="activeDeck" class="flex flex-col gap-8">
				<!-- LIST VIEW -->
				<div v-if="viewMode === 'list'" class="flex flex-col gap-8">
					<!-- Mainboard -->
					<div v-if="mainboardCards.length > 0">
						<h4 class="font-semibold mb-2 text-sm uppercase tracking-wide text-muted">
							Mainboard ({{ mainboardTotal }})
						</h4>
						<div ref="mainboardGroupContainer" class="deck-type-grid" :style="mainboardGridStyle">
							<div v-for="(column, columnIndex) in mainboardColumns" :key="`mainboard-column-${columnIndex}`" class="deck-type-column">
								<div v-for="[type, groupedCards] in column" :key="type" class="deck-type-group">
									<p class="text-sm text-muted uppercase mb-1">
										{{ type }} <em>({{ groupedCards.reduce((s, c) => s + c.quantity, 0) }})</em>
									</p>
									<ul class="flex flex-col gap-0.5">
										<PlayerDeckListCardItem
											v-for="card in groupedCards"
											:key="card.name"
											:card="card"
											:image-url="getCardImageUrl(card)"
											:is-active="activePreviewCard === `${card.compartment}-${card.name}`"
											selectable
											:key-card="selectedKeyCards.has(card.name)"
											@preview="handlePreviewUpdate"
											@pin="togglePreviewPin"
											@toggle-key-card="emit('toggleKeyCard', card.name)"
										/>
									</ul>
								</div>
							</div>
						</div>
					</div>

					<!-- Sideboard -->
					<div v-if="sideboardCards.length > 0" class="border-t border-default pt-8">
						<h4 class="font-semibold mb-2 text-sm uppercase tracking-wide text-muted">
							Sideboard ({{ sideboardTotal }})
						</h4>
						<div ref="sideboardGroupContainer" class="deck-type-grid" :style="sideboardGridStyle">
							<div v-for="(column, columnIndex) in sideboardColumns" :key="`sideboard-column-${columnIndex}`" class="deck-type-column">
								<div v-for="[type, groupedCards] in column" :key="type" class="deck-type-group">
									<p class="text-sm text-muted uppercase mb-1">
										{{ type }} <em>({{ groupedCards.reduce((s, c) => s + c.quantity, 0) }})</em>
									</p>
									<ul class="flex flex-col gap-0.5">
										<PlayerDeckListCardItem
											v-for="card in groupedCards"
											:key="card.name"
											:card="card"
											:image-url="getCardImageUrl(card)"
											:is-active="activePreviewCard === `${card.compartment}-${card.name}`"
											selectable
											:key-card="selectedKeyCards.has(card.name)"
											@preview="handlePreviewUpdate"
											@pin="togglePreviewPin"
											@toggle-key-card="emit('toggleKeyCard', card.name)"
										/>
									</ul>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- GRID VIEW -->
				<div v-else class="flex flex-col gap-6">
					<ArchetypeDeckCardGrid
						v-if="mainboardCards.length > 0"
						:cards="mainboardCards"
						:card-data-map="cardDataMap"
						compartment-label="Mainboard"
						:total-count="mainboardTotal"
						:selected-key-cards="selectedKeyCards"
						selectable
						@toggle-key-card="name => emit('toggleKeyCard', name)"
					/>
					<ArchetypeDeckCardGrid
						v-if="sideboardCards.length > 0"
						:cards="sideboardCards"
						:card-data-map="cardDataMap"
						compartment-label="Sideboard"
						:total-count="sideboardTotal"
						:selected-key-cards="selectedKeyCards"
						selectable
						@toggle-key-card="name => emit('toggleKeyCard', name)"
					/>
				</div>

				<!-- Mana curve chart -->
				<div v-if="Object.keys(curveData).length > 0">
					<h4 class="font-semibold mb-3 text-sm uppercase tracking-wide text-muted">
						Mana Curve
					</h4>
					<DeckManaCurveChart :curve="curveData" :height="200" />
				</div>
			</div>

			<!-- No deck list -->
			<div v-else class="flex items-center justify-center py-16 text-center">
				<p class="text-sm text-muted">
					No deck list available for this player.
				</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.deck-type-grid {
	display: grid;
	align-items: start;
}

.deck-type-column {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	min-width: 0;
}

.deck-type-group {
	min-width: 0;
}
</style>
