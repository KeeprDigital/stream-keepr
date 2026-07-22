<script setup lang="ts">
import type { DeckListCard, ManaCurve, PlayerDeckList } from '~~/shared/types/deckList';
import type { MtgCard } from '~/types/card/mtg';
import { useElementSize } from '@vueuse/core';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { getDeckColumnCount, splitDeckGroupsIntoColumns } from '~~/shared/utils/deckColumns';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { formatPips, formatStats } from '~~/shared/utils/deckStats';
import { uniqueDeckTokens } from '~~/shared/utils/deckTokens';
import { formatHighlanderPointsLabel } from '~~/shared/utils/highlander';
import { createDeckLookupCards, getDeckCardImageUrl } from '~~/shared/utils/playerDeck';

const props = defineProps<{
	playerName: string;
	deckLists: PlayerDeckList[];
	playerId?: number;
	loading?: boolean;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const eventStore = useEventStore();
const reviewPagePath = computed(() => props.playerId != null && eventStore.eventId
	? `/event/${eventStore.eventId}/archetype-review?playerId=${props.playerId}`
	: null);

async function reviewDeck() {
	if (!reviewPagePath.value)
		return;
	close();
	await navigateTo(reviewPagePath.value);
}

const localDeckLists = ref<PlayerDeckList[]>(props.deckLists.map(deck => structuredClone(deck)));

watch(() => props.deckLists, (nextDeckLists) => {
	localDeckLists.value = nextDeckLists.map(deck => structuredClone(deck));
}, { deep: true });

// Send deck to screen functionality (only when playerId is provided)
const { hasDeckScreens, deckScreens, sendToScreen, sendToFirstDeckScreen } = useSendDeckToScreen();

const canSendToScreen = computed(() => props.playerId != null && hasDeckScreens.value);

async function handleSendToScreen(screenId?: number) {
	if (props.playerId == null)
		return;
	if (screenId) {
		const screen = deckScreens.value.find(s => s.id === screenId);
		if (screen) {
			await sendToScreen(props.playerId, screen);
		}
	}
	else {
		await sendToFirstDeckScreen(props.playerId);
	}
}

// Default to the first tab
const defaultDeckIndex = computed(() => 0);

const selectedDeckIndex = ref(defaultDeckIndex.value);

// Re-sync when the modal opens with a different phase
watch(defaultDeckIndex, (idx) => {
	selectedDeckIndex.value = idx;
});

// Get the currently selected deck list
const selectedDeck = computed(() => localDeckLists.value[selectedDeckIndex.value] ?? null);

// ── Deck card computeds ──────────────────────────────────────────────────────

const cards = computed(() => selectedDeck.value?.cards ?? []);
const {
	mainboardCards,
	sideboardCards,
	mainboardTotal,
	sideboardTotal,
	mainboardByType,
	sideboardByType,
} = useDeckCardGroups(cards);

const DECK_TYPE_COLUMN_GAP = 24;
const MODAL_DECK_TYPE_MIN_COLUMN_WIDTH = 224;
const MODAL_BASE_CONTENT_WIDTH = 240;
const MODAL_WIDTH_BUCKETS = [
	{ maxWidth: 1024, className: 'sm:max-w-5xl' },
	{ maxWidth: 1152, className: 'sm:max-w-6xl' },
	{ maxWidth: Number.POSITIVE_INFINITY, className: 'sm:max-w-screen-xl' },
] as const;

const mainboardGroupContainer = ref<HTMLElement | null>(null);
const sideboardGroupContainer = ref<HTMLElement | null>(null);
const { width: mainboardGroupWidth } = useElementSize(mainboardGroupContainer);
const { width: sideboardGroupWidth } = useElementSize(sideboardGroupContainer);

const mainboardGroups = computed(() => [...mainboardByType.value.entries()]);
const sideboardGroups = computed(() => [...sideboardByType.value.entries()]);

function getGroupColumnWeight<T>(groups: readonly (readonly [string, T[]])[]) {
	return groups.reduce((total, [, groupedCards]) => total + groupedCards.length + 1, 0);
}

function getPreferredGroupColumnCount(groupWeight: number, groupCount: number) {
	if (groupCount <= 1) {
		return 1;
	}

	if (groupWeight >= 44 || groupCount >= 6) {
		return 3;
	}

	if (groupWeight >= 20 || groupCount >= 3) {
		return 2;
	}

	return 1;
}

function getDeckTypeGridStyle(columnCount: number) {
	return {
		gridTemplateColumns: `repeat(${Math.max(columnCount, 1)}, minmax(0, 1fr))`,
		columnGap: `${DECK_TYPE_COLUMN_GAP}px`,
	};
}

const mainboardColumnCount = computed(() =>
	getDeckColumnCount(
		mainboardGroupWidth.value,
		MODAL_DECK_TYPE_MIN_COLUMN_WIDTH,
		DECK_TYPE_COLUMN_GAP,
		mainboardGroups.value.length,
	),
);

const sideboardColumnCount = computed(() =>
	getDeckColumnCount(
		sideboardGroupWidth.value,
		MODAL_DECK_TYPE_MIN_COLUMN_WIDTH,
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
const modalContentClass = computed(() => {
	const mainboardPreferredColumns = getPreferredGroupColumnCount(
		getGroupColumnWeight(mainboardGroups.value),
		mainboardGroups.value.length,
	);
	const sideboardPreferredColumns = sideboardGroups.value.length > 0
		? getPreferredGroupColumnCount(getGroupColumnWeight(sideboardGroups.value), sideboardGroups.value.length)
		: 0;
	const preferredWidth = MODAL_BASE_CONTENT_WIDTH
		+ (mainboardPreferredColumns * MODAL_DECK_TYPE_MIN_COLUMN_WIDTH)
		+ (sideboardPreferredColumns > 0 ? sideboardPreferredColumns * MODAL_DECK_TYPE_MIN_COLUMN_WIDTH : 0)
		+ ((mainboardPreferredColumns > 0 && sideboardPreferredColumns > 0) ? DECK_TYPE_COLUMN_GAP : 0);

	return MODAL_WIDTH_BUCKETS.find(({ maxWidth }) => preferredWidth <= maxWidth)?.className ?? 'sm:max-w-screen-xl';
});

// Curve data comes pre-calculated from the server
const curveData = computed((): ManaCurve => selectedDeck.value?.curve ?? {});

// Tab items for deck list selection
const tabItems = computed(() => {
	return localDeckLists.value.map((deck, index) => ({
		label: deck.phaseName || deck.name || `Deck ${index + 1}`,
		value: index.toString(),
		slot: `deck-${index}`,
	}));
});

// Card image preview
const { fetchScryfallCards } = useScryfallBatch();
const cardDataMap = shallowRef(new Map<string, MtgCard>());

const {
	activePreviewCard,
	handlePreviewUpdate,
	togglePreviewPin,
	resetPreview,
} = useCardPreview();

function close() {
	resetPreview();
	emit('close');
}

watch(selectedDeck, async (deck) => {
	resetPreview();
	cardDataMap.value = new Map();
	if (!deck)
		return;
	const lookupCards = createDeckLookupCards(deck.cards, deck.companion);
	cardDataMap.value = await fetchScryfallCards(lookupCards);
}, { immediate: true });

function getCardImageUrl(card: DeckListCard): string | null {
	return getDeckCardImageUrl(cardDataMap.value, card);
}

function getCompanionImageUrl() {
	if (!selectedDeck.value?.companion) {
		return null;
	}

	const companion = selectedDeck.value.companion;
	return getDeckCardImageUrl(cardDataMap.value, companion);
}

const highlanderImageUrlsByCardName = computed<Record<string, string | null>>(() => {
	const imageUrls: Record<string, string | null> = {};
	for (const card of cards.value) {
		imageUrls[card.name] = getCardImageUrl(card);
	}
	if (selectedDeck.value?.companion) {
		imageUrls[selectedDeck.value.companion.name] = getCompanionImageUrl();
	}
	return imageUrls;
});

const selectedDeckCounters = computed(() => {
	const counterTypes = cards.value.flatMap(card => card.deckCounterTypes ?? []);
	return counterConfigsForDeckCounterTypes(counterTypes, getCounterTypeConfigs('mtg'));
});

const selectedDeckTokens = computed(() => {
	return uniqueDeckTokens(cards.value.flatMap(card => card.deckTokens ?? []));
});

const tokenCards = computed<DeckListCard[]>(() => selectedDeckTokens.value.map(token => ({
	name: token.name,
	setCode: null,
	quantity: 0,
	compartment: 'sideboard',
	cardType: token.typeLine,
	scryfallId: token.scryfallId,
})));

function tokenImageUrl(scryfallId: string | null): string | null {
	return scryfallId
		? `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`
		: null;
}
</script>

<template>
	<UModal
		:close="{ onClick: close }"
		:ui="{ content: modalContentClass }"
	>
		<template v-if="selectedDeck" #title>
			<div class="flex items-center gap-2">
				<span>{{ playerName }}</span>
				<span class="text-muted mx-2">|</span>
				<span class="text-muted">
					{{ selectedDeck.name }}
				</span>
				<div v-if="selectedDeck.pips && formatPips(selectedDeck.pips).length > 0" class="flex items-center gap-2 ml-1">
					<div
						v-for="pip in formatPips(selectedDeck.pips)"
						:key="pip.color"
						class="flex items-center gap-0.5"
					>
						<MtgManaColorDisplay :colors="pip.color" size="sm" />
						<span class="font-mono text-xs text-muted ml-0.5">{{ pip.count }}</span>
					</div>
				</div>
				<MtgManaColorDisplay
					v-else-if="selectedDeck.colors"
					:colors="selectedDeck.colors"
					size="sm"
					class="ml-1"
				/>
				<UBadge
					v-if="selectedDeck.highlander"
					color="neutral"
					variant="soft"
					size="lg"
					class="ml-2 px-3 py-1 text-sm font-semibold"
				>
					{{ formatHighlanderPointsLabel(selectedDeck.highlander) }}
				</UBadge>
				<div v-if="selectedDeckCounters.length > 0" class="flex items-center gap-1.5 ml-2">
					<span class="text-xs uppercase tracking-wide text-muted">Counters</span>
					<UBadge
						v-for="counter in selectedDeckCounters"
						:key="counter.key"
						color="neutral"
						variant="soft"
						size="sm"
						class="gap-1"
					>
						<UIcon :name="counter.icon" class="size-3.5" />
						{{ counter.label }}
					</UBadge>
				</div>
			</div>
		</template>
		<template #description>
			<div class="flex items-start justify-between gap-4">
				<div v-if="selectedDeck?.stats" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
					<span v-for="stat in formatStats(selectedDeck.stats)" :key="stat.type">
						<span class="font-medium text-default me-1">{{ stat.count }}</span>
						<span class="text-muted">{{ stat.type }}</span>
					</span>
				</div>
				<span v-else>Deck List</span>
			</div>
		</template>
		<template #body>
			<div v-if="props.loading && localDeckLists.length === 0" class="min-h-48 flex items-center justify-center">
				<UILoadingSpinner size="sm" label="Loading deck list..." />
			</div>

			<UIEmptyState
				v-else-if="localDeckLists.length === 0"
				variant="inline"
				icon="i-lucide-layers"
				title="No deck list available"
			/>

			<div v-else class="flex flex-col gap-4">
				<MtgHighlanderSummary :highlander="selectedDeck?.highlander" :image-urls-by-card-name="highlanderImageUrlsByCardName" compact />

				<!-- Deck selector tabs (only show if multiple decks) -->
				<UISegmentedTabs
					v-if="localDeckLists.length > 1"
					:items="tabItems"
					:model-value="selectedDeckIndex.toString()"
					@update:model-value="(val) => selectedDeckIndex = Number(val)"
				/>

				<!-- Deck list content -->
				<div v-if="selectedDeck" class="flex flex-col gap-6">
					<!-- Mainboard + sideboard -->
					<div class="flex gap-6">
						<!-- Mainboard -->
						<div v-if="mainboardCards.length > 0" class="flex-1 min-w-0">
							<h4 class="font-semibold mb-3 text-sm uppercase tracking-wide">
								Mainboard ({{ mainboardTotal }})
							</h4>
							<div ref="mainboardGroupContainer" class="deck-type-grid" :style="mainboardGridStyle">
								<div v-for="(column, columnIndex) in mainboardColumns" :key="`mainboard-column-${columnIndex}`" class="deck-type-column">
									<div v-for="[type, groupedCards] in column" :key="type" class="deck-type-group">
										<p class="text-xs text-muted uppercase mb-1">
											{{ type }} <em>({{ groupedCards.reduce((s, c) => s + c.quantity, 0) }})</em>
										</p>
										<ul class="flex flex-col gap-0.5">
											<PlayerDeckListCardItem
												v-for="card in groupedCards"
												:key="card.name"
												:card="card"
												:image-url="getCardImageUrl(card)"
												:is-active="activePreviewCard === `${card.compartment}-${card.name}`"
												@preview="handlePreviewUpdate"
												@pin="togglePreviewPin"
											/>
										</ul>
									</div>
								</div>
							</div>
						</div>

						<!-- Sideboard -->
						<div v-if="sideboardCards.length > 0 || tokenCards.length > 0" class="shrink-0 border-l border-default pl-6">
							<div v-if="sideboardCards.length > 0">
								<h4 class="font-semibold mb-3 text-sm uppercase tracking-wide">
									Sideboard ({{ sideboardTotal }})
								</h4>
								<div ref="sideboardGroupContainer" class="deck-type-grid" :style="sideboardGridStyle">
									<div v-for="(column, columnIndex) in sideboardColumns" :key="`sideboard-column-${columnIndex}`" class="deck-type-column">
										<div v-for="[type, groupedCards] in column" :key="type" class="deck-type-group">
											<p class="text-xs text-muted uppercase mb-1">
												{{ type }} <em>({{ groupedCards.reduce((s, c) => s + c.quantity, 0) }})</em>
											</p>
											<ul class="flex flex-col gap-0.5">
												<PlayerDeckListCardItem
													v-for="card in groupedCards"
													:key="card.name"
													:card="card"
													:image-url="getCardImageUrl(card)"
													:is-active="activePreviewCard === `${card.compartment}-${card.name}`"
													@preview="handlePreviewUpdate"
													@pin="togglePreviewPin"
												/>
											</ul>
										</div>
									</div>
								</div>
							</div>

							<section v-if="tokenCards.length > 0" class="token-section" :class="{ 'mt-5': sideboardCards.length > 0 }">
								<h4 class="font-semibold mb-3 text-sm uppercase tracking-wide">
									Tokens ({{ tokenCards.length }})
								</h4>
								<ul class="flex flex-col gap-0.5">
									<PlayerDeckListCardItem
										v-for="(card, index) in tokenCards"
										:key="`${card.scryfallId ?? card.name}-${index}`"
										:card="card"
										:image-url="tokenImageUrl(card.scryfallId)"
										:is-active="activePreviewCard === `token-${selectedDeckTokens[index]?.id}`"
										:preview-key="`token-${selectedDeckTokens[index]?.id}`"
										:show-quantity="false"
										@preview="handlePreviewUpdate"
										@pin="togglePreviewPin"
									/>
								</ul>
							</section>
						</div>
					</div>

					<!-- Mana curve chart full width below -->
					<div v-if="Object.keys(curveData).length > 0">
						<h4 class="font-semibold mb-3 text-sm uppercase tracking-wide">
							Mana Curve
						</h4>
						<DeckManaCurveChart :curve="curveData" />
					</div>
				</div>
			</div>
		</template>
		<template v-if="reviewPagePath || canSendToScreen" #footer>
			<div
				class="flex w-full items-center gap-3"
				:class="canSendToScreen ? 'justify-between' : 'justify-end'"
			>
				<UButton
					v-if="reviewPagePath"
					color="neutral"
					variant="ghost"
					icon="i-lucide-list-checks"
					@click="reviewDeck"
				>
					Review deck
				</UButton>

				<div v-if="canSendToScreen" class="flex justify-end gap-2">
					<!-- Single deck screen - direct button -->
					<UButton
						v-if="deckScreens.length === 1"
						icon="i-lucide-send"
						color="primary"
						@click="handleSendToScreen()"
					>
						Send to Screen
					</UButton>
					<!-- Multiple deck screens - dropdown -->
					<UDropdownMenu
						v-else
						:items="[[
							...deckScreens.map(s => ({
								label: s.name,
								icon: 'i-lucide-monitor',
								onSelect: () => handleSendToScreen(s.id),
							})),
						]]"
					>
						<UButton
							icon="i-lucide-send"
							color="primary"
							trailing-icon="i-lucide-chevron-down"
						>
							Send to Screen
						</UButton>
					</UDropdownMenu>
				</div>
			</div>
		</template>
	</UModal>
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

.token-section {
	border-top: 1px solid var(--ui-border-muted);
	padding-top: 1rem;
}
</style>
