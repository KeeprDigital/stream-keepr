<script setup lang="ts">
import type { QuantityPosition } from '~~/shared/types/enums';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { formatHighlanderPointedCardNote, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';

const { screen } = useScreenContext();

const {
	config,
	playerName,
	deckName,
	deckColors,
	companion,
	highlander,
	deckCounters = computed(() => []),
	deckStats,
	mainboard,
	sideboard,
	error,
	hasDisplayedDeck,
	displayedDeckVersion,
	pendingSwapVersion,
	commitPendingDeck,
} = useDeckModeData();

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);
const primaryTextStyle = computed(() => {
	return screenConfig.value.primaryTextColor
		? { color: screenConfig.value.primaryTextColor }
		: {};
});
const secondaryTextStyle = computed(() => {
	return screenConfig.value.secondaryTextColor
		? { color: screenConfig.value.secondaryTextColor }
		: {};
});

const showDeckBody = ref(hasDisplayedDeck.value);
const awaitingSwapCommit = ref(false);

watch(hasDisplayedDeck, async (value) => {
	if (value && !showDeckBody.value && !awaitingSwapCommit.value) {
		await nextTick();
		showDeckBody.value = true;
		return;
	}

	if (!value && !awaitingSwapCommit.value) {
		showDeckBody.value = false;
	}
}, { immediate: true });

watch(pendingSwapVersion, async () => {
	if (!hasDisplayedDeck.value) {
		commitPendingDeck();
		await nextTick();
		showDeckBody.value = hasDisplayedDeck.value;
		return;
	}

	if (!showDeckBody.value) {
		awaitingSwapCommit.value = true;
		return;
	}

	awaitingSwapCommit.value = true;
	showDeckBody.value = false;
});

async function handleDeckAfterLeave() {
	if (!awaitingSwapCommit.value) {
		return;
	}

	awaitingSwapCommit.value = false;
	commitPendingDeck();
	await nextTick();
	showDeckBody.value = hasDisplayedDeck.value;
}

const viewMode = computed(() => config.value.viewMode ?? 'grid');
const gridColumns = computed(() => config.value.columns ?? 4);
const listColumns = computed(() => config.value.listColumns ?? 2);
const cardGap = computed(() => config.value.cardGap ?? 8);
const showMainboard = computed(() => config.value.showMainboard !== false);
const sideboardLayout = computed(() => config.value.sideboardLayout ?? 'stack');
const showSideboard = computed(() => config.value.showSideboard !== false && sideboard.value.length > 0);
const stackOverlap = computed(() => config.value.stackOverlap ?? 15);
const showHighlanderPoints = computed(() => config.value.showHighlanderPoints !== false);
const showHighlanderTotal = computed(() =>
	config.value.showHighlanderTotal !== false
	&& !!highlander.value,
);
const showHighlanderPointedCards = computed(() =>
	config.value.showHighlanderPointedCards !== false
	&& !!highlander.value
	&& highlander.value.pointedCards.length > 0,
);
const showDeckMetaPill = computed(() => config.value.showDeckMetaPill !== false);
const highlanderTotalLabel = computed(() =>
	highlander.value ? formatHighlanderPointsLabel(highlander.value) : '',
);
const highlanderPointedCardsList = computed(() => highlander.value?.pointedCards ?? []);
const showTopHeader = computed(() =>
	config.value.showDeckName
	|| (config.value.showDeckColors && !!deckColors),
);
const showDeckMeta = computed(() =>
	(config.value.showDeckStats && deckStats.value.length > 0)
	|| !!companion.value
	|| deckCounters.value.length > 0
	|| showHighlanderTotal.value,
);
const showHeader = computed(() =>
	showTopHeader.value
	|| showDeckMeta.value
	|| showHighlanderPointedCards.value,
);

// Grid style with dynamic gap
const gridStyle = computed(() => ({
	gridTemplateColumns: `repeat(${gridColumns.value}, minmax(0, 1fr))`,
	gap: `${cardGap.value}px`,
}));

const listGridStyle = computed(() => ({
	gridTemplateColumns: `repeat(${listColumns.value}, minmax(0, 1fr))`,
	columnGap: '1rem',
	rowGap: '0.25rem',
}));

// Card size - either dynamic or fixed class
const cardSizeClass = computed(() => {
	if (config.value.dynamicCardSize) {
		return '';
	}
	switch (config.value.cardSize) {
		case 'small':
			return 'w-24';
		case 'large':
			return 'w-48';
		default:
			return 'w-36';
	}
});

// Quantity badge position styles
const BADGE_POSITION_CLASSES: Record<QuantityPosition, string> = {
	'top-left': '-top-1 -left-1',
	'top-center': '-top-1 left-1/2 -translate-x-1/2',
	'top-right': '-top-1 -right-1',
	'left-center': 'top-1/2 -left-1 -translate-y-1/2',
	'right-center': 'top-1/2 -right-1 -translate-y-1/2',
	'bottom-left': '-bottom-1 -left-1',
	'bottom-center': '-bottom-1 left-1/2 -translate-x-1/2',
	'bottom-right': '-bottom-1 -right-1',
};

const quantityPositionClass = computed(() => {
	const pos: QuantityPosition = config.value.quantityPosition ?? 'top-right';
	return BADGE_POSITION_CLASSES[pos];
});

const highlanderPointsPositionClass = computed(() => {
	const pos: QuantityPosition = config.value.highlanderPointsPosition ?? 'top-left';
	return BADGE_POSITION_CLASSES[pos];
});

const quantityBadgeStyle = computed(() => {
	return {
		color: config.value.quantityTextColor ?? '#ffffff',
		backgroundColor: config.value.quantityBgColor ?? '#7c3aed',
	};
});

const highlanderPointBadgeStyle = computed(() => {
	return {
		color: config.value.highlanderPointsTextColor ?? '#ffffff',
		backgroundColor: config.value.highlanderPointsBgColor ?? '#7c3aed',
	};
});

// Quantity badge size classes
const QUANTITY_SIZE_CLASSES: Record<string, string> = {
	small: 'w-6 h-6 text-sm',
	medium: 'w-7 h-7 text-base',
	large: 'w-8 h-8 text-lg',
};
const quantitySizeClass = computed((): string => {
	const size = config.value.quantitySize ?? 'medium';
	return QUANTITY_SIZE_CLASSES[size] || 'w-7 h-7 text-base';
});

const HIGHLANDER_POINT_SIZE_CLASSES: Record<string, string> = {
	small: 'min-w-6 px-2 py-0.5 text-xs',
	medium: 'min-w-7 px-2.5 py-1 text-sm',
	large: 'min-w-8 px-3 py-1.5 text-base',
};

const highlanderPointBadgeClass = computed((): string => {
	const size = config.value.highlanderPointsSize ?? 'medium';
	return HIGHLANDER_POINT_SIZE_CLASSES[size] || 'min-w-7 px-2.5 py-1 text-sm';
});

const DECK_META_PILL_SIZE_CLASSES: Record<string, string> = {
	small: 'px-4 py-1.5 text-sm gap-x-3 gap-y-1',
	medium: 'px-5 py-2 text-base gap-x-4 gap-y-1.5',
	large: 'px-6 py-2.5 text-lg gap-x-5 gap-y-2',
};

const HIGHLANDER_POINTED_CARD_SIZE_CLASSES: Record<string, string> = {
	small: 'px-2.5 py-1 text-xs',
	medium: 'px-3 py-1 text-sm',
	large: 'px-3.5 py-1.5 text-base',
};

const deckMetaPillClass = computed((): string => {
	const size = config.value.deckMetaPillSize ?? 'medium';
	return DECK_META_PILL_SIZE_CLASSES[size] || 'px-5 py-2 text-base gap-x-4 gap-y-1.5';
});

const deckMetaPillStyle = computed(() => {
	if (!showDeckMetaPill.value) {
		return {};
	}

	return {
		color: config.value.deckMetaPillTextColor ?? '#111827',
		background: config.value.deckMetaPillBgColor ?? '#ffffff',
		borderColor: config.value.deckMetaPillBorderColor,
	};
});

const deckMetaAccentStyle = computed(() => {
	return showDeckMetaPill.value
		? { color: config.value.deckMetaPillAccentColor ?? '#7c3aed' }
		: primaryTextStyle.value;
});

const deckMetaTextStyle = computed(() => {
	return showDeckMetaPill.value
		? { color: config.value.deckMetaPillTextColor ?? '#111827' }
		: secondaryTextStyle.value;
});

const highlanderPointedCardClass = computed((): string => {
	const size = config.value.highlanderPointedCardsSize ?? 'medium';
	return HIGHLANDER_POINTED_CARD_SIZE_CLASSES[size] || 'px-3 py-1 text-sm';
});

const highlanderPointedCardStyle = computed(() => {
	return {
		color: config.value.highlanderPointedCardsTextColor ?? '#111827',
		background: config.value.highlanderPointedCardsBgColor ?? '#ffffff',
		borderColor: config.value.highlanderPointedCardsBorderColor,
	};
});

const highlanderPointedCardAccentStyle = computed(() => {
	return {
		color: config.value.highlanderPointedCardsAccentColor ?? '#7c3aed',
	};
});

const highlanderPointedCardNoteStyle = computed(() => {
	return {
		color: config.value.highlanderPointedCardsTextColor ?? '#111827',
		opacity: '0.7',
	};
});

const showQuantities = computed(() => config.value.showQuantities ?? false);
const isDynamicSize = computed(() => config.value.dynamicCardSize ?? false);

// Card heights based on width (MTG card ratio is ~63:88)
const cardHeightMap: Record<string, number> = {
	small: 134, // w-24 = 96px → 96 * 88/63 ≈ 134px
	medium: 201, // w-36 = 144px → 144 * 88/63 ≈ 201px
	large: 268, // w-48 = 192px → 192 * 88/63 ≈ 268px
};

// Get the estimated card height based on size setting
const estimatedCardHeight = computed(() => {
	const size = config.value.cardSize ?? 'medium';
	return cardHeightMap[size] ?? 201;
});

// Calculate the offset for each stacked card
const stackOffsetPx = computed(() => {
	const visiblePercent = stackOverlap.value / 100;
	return Math.round(estimatedCardHeight.value * visiblePercent);
});

// Get absolute position for stack card
function getStackCardStyle(index: number) {
	return {
		position: 'absolute' as const,
		top: `${index * stackOffsetPx.value}px`,
		left: '0',
		right: '0',
	};
}

// Calculate total height of stack container
const stackContainerHeight = computed(() => {
	const cardCount = sideboard.value.length;
	if (cardCount === 0)
		return '0px';
	const totalHeight = ((cardCount - 1) * stackOffsetPx.value) + estimatedCardHeight.value;
	return `${totalHeight}px`;
});
</script>

<template>
	<ScreenModeBase
		:error="error"
	>
		<!-- Deck Content -->
		<div class="deck-content overflow-hidden w-full h-full">
			<transition mode="out-in" name="deck-swap" @after-leave="handleDeckAfterLeave">
				<div v-if="showDeckBody && hasDisplayedDeck" :key="displayedDeckVersion" class="deck-body w-full h-full">
					<!-- Header -->
					<div v-if="showHeader" class="deck-header mb-4 text-center">
						<div
							v-if="showTopHeader"
							class="flex flex-wrap items-center justify-center gap-3"
						>
							<template v-if="config.showDeckName">
								<h2 class="text-xl font-bold" :style="primaryTextStyle">
									{{ playerName }}
								</h2>
								<p v-if="deckName" class="text-muted" :style="secondaryTextStyle">
									{{ deckName }}
								</p>
							</template>

							<MtgManaColorDisplay v-if="config.showDeckColors && deckColors" :colors="deckColors" size="lg" />
						</div>

						<div
							v-if="showDeckMeta"
							data-testid="deck-meta-pill"
							class="mt-3 flex flex-wrap items-center justify-center border"
							:class="showDeckMetaPill ? ['inline-flex rounded-full', deckMetaPillClass] : ['gap-x-4 gap-y-1 text-sm border-transparent px-0 py-0']"
							:style="deckMetaPillStyle"
						>
							<div v-if="companion" class="flex items-center gap-2">
								<span :class="showDeckMetaPill ? '' : 'text-muted'" :style="deckMetaTextStyle">Companion:</span>
								<span class="font-medium" :style="deckMetaAccentStyle">{{ companion.name }}</span>
							</div>

							<div v-if="deckCounters.length > 0" class="flex items-center gap-2">
								<span :class="showDeckMetaPill ? '' : 'text-muted'" :style="deckMetaTextStyle">Counters:</span>
								<span
									v-for="counter in deckCounters"
									:key="counter.key"
									class="inline-flex items-center gap-1 font-medium"
									:style="deckMetaAccentStyle"
								>
									<UIcon :name="counter.icon" class="size-4" />
									{{ counter.label }}
								</span>
							</div>

							<p
								v-if="showHighlanderTotal"
								data-testid="highlander-total-inline"
								:class="showDeckMetaPill ? 'font-medium' : 'text-muted'"
								:style="showDeckMetaPill ? deckMetaAccentStyle : undefined"
							>
								{{ highlanderTotalLabel }}
							</p>

							<span
								v-for="stat in (config.showDeckStats ? deckStats : [])"
								:key="stat.type"
							>
								<span class="font-medium me-1" :class="showDeckMetaPill ? '' : 'text-default'" :style="showDeckMetaPill ? deckMetaAccentStyle : undefined">{{ stat.count }}</span>
								<span :class="showDeckMetaPill ? '' : 'text-muted'" :style="deckMetaTextStyle">{{ stat.type }}</span>
							</span>
						</div>

						<div v-if="showHighlanderPointedCards" class="mt-3 flex flex-wrap justify-center gap-2" data-testid="highlander-pointed-cards">
							<span
								v-for="card in highlanderPointedCardsList"
								:key="card.name"
								data-testid="highlander-pointed-card-chip"
								class="inline-flex items-center gap-1 rounded-full border border-default leading-none"
								:class="highlanderPointedCardClass"
								:style="highlanderPointedCardStyle"
							>
								<span class="font-semibold" :style="highlanderPointedCardAccentStyle">{{ card.points }}</span>
								<span>{{ card.name }}</span>
								<span v-if="formatHighlanderPointedCardNote(card)" :style="highlanderPointedCardNoteStyle">
									{{ formatHighlanderPointedCardNote(card) }}
								</span>
							</span>
						</div>
					</div>

					<!-- Grid View -->
					<template v-if="viewMode === 'grid'">
						<!-- Stack sideboard layout: mainboard left, sideboard stack right -->
						<div v-if="sideboardLayout === 'stack' && showSideboard" class="deck-layout flex gap-6">
							<!-- Mainboard -->
							<div v-if="showMainboard" class="mainboard-section flex-1">
								<div
									class="card-grid"
									:class="{ 'dynamic-grid': isDynamicSize }"
									:style="gridStyle"
								>
									<ScreenModesDeckCard
										v-for="(card, index) in mainboard"
										:key="`main-${index}`"
										:card="card"
										:size-class="cardSizeClass"
										:show-quantity="showQuantities"
										:show-highlander-points="showHighlanderPoints"
										:quantity-position-class="quantityPositionClass"
										:quantity-size-class="quantitySizeClass"
										:quantity-badge-style="quantityBadgeStyle"
										:highlander-points-position-class="highlanderPointsPositionClass"
										:highlander-points-size-class="highlanderPointBadgeClass"
										:highlander-points-badge-style="highlanderPointBadgeStyle"
										:dynamic-size="isDynamicSize"
									/>
								</div>
							</div>

							<!-- Sideboard (Stack Layout) - to the right -->
							<div class="sideboard-stack-section flex flex-col">
								<h3 v-if="showSideboard" class="text-lg font-semibold mb-2" :style="primaryTextStyle">
									Sideboard
								</h3>
								<div
									v-if="showSideboard"
									class="stack-container relative"
									:class="cardSizeClass || 'w-36'"
									:style="{ height: stackContainerHeight }"
								>
									<div
										v-for="(card, index) in sideboard"
										:key="`side-stack-${index}`"
										class="stack-card"
										:style="getStackCardStyle(index)"
									>
										<ScreenModesDeckCard
											:card="card"
											:size-class="cardSizeClass"
											:show-quantity="showQuantities"
											:show-highlander-points="showHighlanderPoints"
											:quantity-position-class="quantityPositionClass"
											:quantity-size-class="quantitySizeClass"
											:quantity-badge-style="quantityBadgeStyle"
											:highlander-points-position-class="highlanderPointsPositionClass"
											:highlander-points-size-class="highlanderPointBadgeClass"
											:highlander-points-badge-style="highlanderPointBadgeStyle"
										/>
									</div>
								</div>
							</div>
						</div>

						<!-- Grid/hidden sideboard layout: vertical stacking -->
						<div v-else class="deck-layout flex flex-col gap-6">
							<!-- Mainboard -->
							<div v-if="showMainboard" class="mainboard-section">
								<div
									class="card-grid"
									:class="{ 'dynamic-grid': isDynamicSize }"
									:style="gridStyle"
								>
									<ScreenModesDeckCard
										v-for="(card, index) in mainboard"
										:key="`main-${index}`"
										:card="card"
										:size-class="cardSizeClass"
										:show-quantity="showQuantities"
										:show-highlander-points="showHighlanderPoints"
										:quantity-position-class="quantityPositionClass"
										:quantity-size-class="quantitySizeClass"
										:quantity-badge-style="quantityBadgeStyle"
										:highlander-points-position-class="highlanderPointsPositionClass"
										:highlander-points-size-class="highlanderPointBadgeClass"
										:highlander-points-badge-style="highlanderPointBadgeStyle"
										:dynamic-size="isDynamicSize"
									/>
								</div>
							</div>

							<!-- Sideboard (Grid Layout) - below mainboard -->
							<div v-if="showSideboard && sideboardLayout === 'grid'" class="sideboard-section">
								<h3 class="text-lg font-semibold mb-2" :style="primaryTextStyle">
									Sideboard
								</h3>
								<div
									class="card-grid"
									:class="{ 'dynamic-grid': isDynamicSize }"
									:style="gridStyle"
								>
									<ScreenModesDeckCard
										v-for="(card, index) in sideboard"
										:key="`side-${index}`"
										:card="card"
										:size-class="cardSizeClass"
										:show-quantity="showQuantities"
										:show-highlander-points="showHighlanderPoints"
										:quantity-position-class="quantityPositionClass"
										:quantity-size-class="quantitySizeClass"
										:quantity-badge-style="quantityBadgeStyle"
										:highlander-points-position-class="highlanderPointsPositionClass"
										:highlander-points-size-class="highlanderPointBadgeClass"
										:highlander-points-badge-style="highlanderPointBadgeStyle"
										:dynamic-size="isDynamicSize"
									/>
								</div>
							</div>
						</div>
					</template>

					<!-- List View -->
					<template v-else>
						<div class="deck-layout flex flex-col gap-6">
							<!-- Mainboard List -->
							<div v-if="showMainboard" class="mainboard-section">
								<h3 class="text-lg font-semibold mb-2" :style="primaryTextStyle">
									Mainboard
								</h3>
								<div data-testid="mainboard-list" class="card-list" :style="listGridStyle">
									<div
										v-for="(card, index) in mainboard"
										:key="`main-${index}`"
										class="card-list-item flex items-center gap-2 py-1 px-2 rounded-lg"
									>
										<span class="quantity text-muted w-6 text-right" :style="secondaryTextStyle">
											{{ card.quantity }}x
										</span>
										<span class="name flex-1" :style="primaryTextStyle">
											{{ card.name }}
										</span>
										<span
											v-if="showHighlanderPoints && card.highlanderPoints != null"
											data-testid="highlander-list-badge"
											class="rounded-md font-mono font-bold leading-none shadow-sm"
											:class="highlanderPointBadgeClass"
											:style="highlanderPointBadgeStyle"
										>
											{{ card.highlanderPoints }}
										</span>
										<span class="type text-muted text-sm" :style="secondaryTextStyle">
											{{ getCardTypeDisplayLabel(card.cardType, { nonbasicLandLabel: true }) }}
										</span>
									</div>
								</div>
							</div>

							<!-- Sideboard List -->
							<div v-if="showSideboard" class="sideboard-section">
								<h3 class="text-lg font-semibold mb-2" :style="primaryTextStyle">
									Sideboard
								</h3>
								<div data-testid="sideboard-list" class="card-list" :style="listGridStyle">
									<div
										v-for="(card, index) in sideboard"
										:key="`side-${index}`"
										class="card-list-item flex items-center gap-2 py-1 px-2 rounded-lg"
									>
										<span class="quantity text-muted w-6 text-right" :style="secondaryTextStyle">
											{{ card.quantity }}x
										</span>
										<span class="name flex-1" :style="primaryTextStyle">
											{{ card.name }}
										</span>
										<span
											v-if="showHighlanderPoints && card.highlanderPoints != null"
											data-testid="highlander-list-badge"
											class="rounded-md font-mono font-bold leading-none shadow-sm"
											:class="highlanderPointBadgeClass"
											:style="highlanderPointBadgeStyle"
										>
											{{ card.highlanderPoints }}
										</span>
										<span class="type text-muted text-sm" :style="secondaryTextStyle">
											{{ getCardTypeDisplayLabel(card.cardType, { nonbasicLandLabel: true }) }}
										</span>
									</div>
								</div>
							</div>
						</div>
					</template>
				</div>
			</transition>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.card-grid {
	display: grid;
}

.card-list {
	display: grid;
}

.card-grid.dynamic-grid :deep(.card-item) {
	width: 100%;
}

.deck-swap-enter-active,
.deck-swap-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.deck-swap-enter-from,
.deck-swap-leave-to {
	opacity: 0;
	transform: scale(0.985);
}

.deck-swap-enter-to,
.deck-swap-leave-from {
	opacity: 1;
	transform: scale(1);
}
</style>
