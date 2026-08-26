<script setup lang="ts">
import type { DeckCardSize, QuantityPosition } from '~~/shared/types/enums';
import type { ResolvedDeckBoardLayout, ScreenConfig } from '~~/shared/types/screenConfig';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { resolveDeckBoards } from '~~/shared/types/screenConfig';
import { formatHighlanderPointedCardNote, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';

const { screen } = useScreenContext();

const {
	config,
	primaryHeader,
	secondaryHeader,
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

const resolvedBoards = computed(() => resolveDeckBoards(config.value));
const board = computed(() => resolvedBoards.value.board);
const showMainboard = computed(() => board.value !== 'sideboard' && mainboard.value.length > 0);
const showSideboard = computed(() => board.value !== 'mainboard' && sideboard.value.length > 0);

// A vertical strip only reads beside a mainboard; every other stacked board
// renders as a horizontal overlapping row (#478).
const sideboardBeside = computed(() =>
	board.value === 'full'
	&& resolvedBoards.value.sideboardPlacement === 'beside'
	&& showMainboard.value
	&& showSideboard.value,
);

interface VisibleBoard {
	key: 'mainboard' | 'sideboard';
	label: string;
	cards: DeckListCardWithData[];
	layout: ResolvedDeckBoardLayout;
	stackVertical: boolean;
	showLabel: boolean;
}

const visibleBoards = computed<VisibleBoard[]>(() => {
	const boards: VisibleBoard[] = [];
	if (showMainboard.value) {
		boards.push({
			key: 'mainboard',
			label: 'Mainboard',
			cards: mainboard.value,
			layout: resolvedBoards.value.mainboard,
			stackVertical: false,
			showLabel: resolvedBoards.value.mainboard.view === 'list',
		});
	}
	if (showSideboard.value) {
		boards.push({
			key: 'sideboard',
			label: 'Sideboard',
			cards: sideboard.value,
			layout: resolvedBoards.value.sideboard,
			stackVertical: sideboardBeside.value,
			showLabel: true,
		});
	}
	return boards;
});

const besideActive = computed(() => sideboardBeside.value && showMainboard.value);

/**
 * In the beside row each board's share of the width follows its column count,
 * so a column reads about the same width on either side. A beside stacked
 * sideboard stays content-sized — its strip has a fixed card width.
 */
function boardFlexStyle(section: VisibleBoard) {
	if (!besideActive.value) {
		return {};
	}
	if (section.key === 'sideboard' && section.layout.view === 'stack') {
		return {};
	}
	const weight = section.layout.view === 'list' ? section.layout.listColumns : section.layout.columns;
	return { flex: `${weight} 1 0%` };
}
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
function gridStyle(layout: ResolvedDeckBoardLayout) {
	return {
		gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
		gap: `${layout.cardGap}px`,
	};
}

function listGridStyle(layout: ResolvedDeckBoardLayout) {
	return {
		gridTemplateColumns: `repeat(${layout.listColumns}, minmax(0, 1fr))`,
		columnGap: '1rem',
		rowGap: '0.25rem',
	};
}

const CARD_SIZE_CLASSES: Record<DeckCardSize, string> = {
	small: 'w-24',
	medium: 'w-36',
	large: 'w-48',
};

// Card size - either dynamic or fixed class
function gridCardSizeClass(layout: ResolvedDeckBoardLayout) {
	return layout.dynamicCardSize ? '' : CARD_SIZE_CLASSES[layout.cardSize];
}

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

const cardBadgeProps = computed(() => ({
	showQuantity: showQuantities.value,
	showHighlanderPoints: showHighlanderPoints.value,
	quantityPositionClass: quantityPositionClass.value,
	quantitySizeClass: quantitySizeClass.value,
	quantityBadgeStyle: quantityBadgeStyle.value,
	highlanderPointsPositionClass: highlanderPointsPositionClass.value,
	highlanderPointsSizeClass: highlanderPointBadgeClass.value,
	highlanderPointsBadgeStyle: highlanderPointBadgeStyle.value,
}));

// Fixed card dimensions per size (MTG card ratio is ~63:88)
const CARD_WIDTH_PX: Record<DeckCardSize, number> = {
	small: 96, // w-24
	medium: 144, // w-36
	large: 192, // w-48
};
const CARD_HEIGHT_PX: Record<DeckCardSize, number> = {
	small: 134, // 96 * 88/63 ≈ 134px
	medium: 201, // 144 * 88/63 ≈ 201px
	large: 268, // 192 * 88/63 ≈ 268px
};

// Vertical strip: each stacked card reveals stackOverlap % of its height.
function stackColumnOffsetPx(layout: ResolvedDeckBoardLayout) {
	return Math.round(CARD_HEIGHT_PX[layout.cardSize] * (layout.stackOverlap / 100));
}

function stackColumnStyle(layout: ResolvedDeckBoardLayout, cardCount: number) {
	const height = cardCount === 0
		? 0
		: ((cardCount - 1) * stackColumnOffsetPx(layout)) + CARD_HEIGHT_PX[layout.cardSize];
	return { height: `${height}px` };
}

function stackColumnCardStyle(layout: ResolvedDeckBoardLayout, index: number) {
	return {
		position: 'absolute' as const,
		top: `${index * stackColumnOffsetPx(layout)}px`,
		left: '0',
		right: '0',
	};
}

// Horizontal row: each stacked card reveals stackOverlap % of its width.
function stackRowOffsetPx(layout: ResolvedDeckBoardLayout) {
	return Math.round(CARD_WIDTH_PX[layout.cardSize] * (layout.stackOverlap / 100));
}

function stackRowStyle(layout: ResolvedDeckBoardLayout, cardCount: number) {
	const width = cardCount === 0
		? 0
		: ((cardCount - 1) * stackRowOffsetPx(layout)) + CARD_WIDTH_PX[layout.cardSize];
	return {
		width: `${width}px`,
		height: `${CARD_HEIGHT_PX[layout.cardSize]}px`,
	};
}

function stackRowCardStyle(layout: ResolvedDeckBoardLayout, index: number) {
	return {
		position: 'absolute' as const,
		left: `${index * stackRowOffsetPx(layout)}px`,
		top: '0',
		width: `${CARD_WIDTH_PX[layout.cardSize]}px`,
	};
}
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
									{{ primaryHeader }}
								</h2>
								<p v-if="secondaryHeader" class="text-muted" :style="secondaryTextStyle">
									{{ secondaryHeader }}
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

					<!-- Boards: each visible board renders its own layout block -->
					<div class="deck-layout flex gap-6" :class="besideActive ? 'flex-row' : 'flex-col'">
						<div
							v-for="section in visibleBoards"
							:key="section.key"
							:data-testid="`${section.key}-section`"
							:class="section.stackVertical ? 'flex flex-col' : ''"
							:style="boardFlexStyle(section)"
						>
							<h3 v-if="section.showLabel" class="text-lg font-semibold mb-2" :style="primaryTextStyle">
								{{ section.label }}
							</h3>

							<!-- Grid -->
							<div
								v-if="section.layout.view === 'grid'"
								:data-testid="`${section.key}-grid`"
								class="card-grid"
								:class="{ 'dynamic-grid': section.layout.dynamicCardSize }"
								:style="gridStyle(section.layout)"
							>
								<ScreenModesDeckCard
									v-for="(card, index) in section.cards"
									:key="`${section.key}-${index}`"
									:card="card"
									:size-class="gridCardSizeClass(section.layout)"
									:dynamic-size="section.layout.dynamicCardSize"
									v-bind="cardBadgeProps"
								/>
							</div>

							<!-- Stack, beside a mainboard: vertical strip -->
							<div
								v-else-if="section.layout.view === 'stack' && section.stackVertical"
								:data-testid="`${section.key}-stack-column`"
								class="stack-container relative"
								:class="CARD_SIZE_CLASSES[section.layout.cardSize]"
								:style="stackColumnStyle(section.layout, section.cards.length)"
							>
								<div
									v-for="(card, index) in section.cards"
									:key="`${section.key}-${index}`"
									class="stack-card"
									:style="stackColumnCardStyle(section.layout, index)"
								>
									<ScreenModesDeckCard
										:card="card"
										:size-class="CARD_SIZE_CLASSES[section.layout.cardSize]"
										v-bind="cardBadgeProps"
									/>
								</div>
							</div>

							<!-- Stack, full width: horizontal overlapping row -->
							<div v-else-if="section.layout.view === 'stack'" class="flex justify-center">
								<div
									:data-testid="`${section.key}-stack-row`"
									class="relative"
									:style="stackRowStyle(section.layout, section.cards.length)"
								>
									<div
										v-for="(card, index) in section.cards"
										:key="`${section.key}-${index}`"
										class="stack-card"
										:style="stackRowCardStyle(section.layout, index)"
									>
										<ScreenModesDeckCard
											:card="card"
											:size-class="CARD_SIZE_CLASSES[section.layout.cardSize]"
											v-bind="cardBadgeProps"
										/>
									</div>
								</div>
							</div>

							<!-- List -->
							<div
								v-else
								:data-testid="`${section.key}-list`"
								class="card-list"
								:style="listGridStyle(section.layout)"
							>
								<div
									v-for="(card, index) in section.cards"
									:key="`${section.key}-${index}`"
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
