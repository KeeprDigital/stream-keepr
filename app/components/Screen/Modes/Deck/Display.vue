<script setup lang="ts">
import type { QuantityPosition } from '~~/shared/types/enums';
import type { ResolvedDeckBoardLayout } from '~~/shared/types/screenConfig';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { formatHighlanderPointedCardNote, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

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

const primaryTextStyle = {
	color: modeTokenVar('deck', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('deck', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('deck', 'title-typography'),
	...primaryTextStyle,
};
/** Set on the root, so everything else reads as body text. */
const displayStyle = {
	...modeTypographyStyle('deck', 'body-typography'),
	...primaryTextStyle,
};

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
	const weight = section.layout.view === 'list'
		? section.layout.listColumns
		: section.layout.columns;
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
	highlander.value
		? formatHighlanderPointsLabel(highlander.value)
		: '',
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

function gridStyle(layout: ResolvedDeckBoardLayout) {
	return {
		gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
		gap: modeTokenVar('deck', 'card-gap'),
	};
}

function listGridStyle(layout: ResolvedDeckBoardLayout) {
	return {
		gridTemplateColumns: `repeat(${layout.listColumns}, minmax(0, 1fr))`,
		columnGap: '1rem',
		rowGap: '0.25rem',
	};
}

// Quantity badge position styles
const BADGE_POSITION_CLASSES: Record<QuantityPosition, string> = {
	'top-left': '-top-1 -left-1',
	'top': '-top-1 left-1/2 -translate-x-1/2',
	'top-right': '-top-1 -right-1',
	'left': 'top-1/2 -left-1 -translate-y-1/2',
	'right': 'top-1/2 -right-1 -translate-y-1/2',
	'bottom-left': '-bottom-1 -left-1',
	'bottom': '-bottom-1 left-1/2 -translate-x-1/2',
	'bottom-right': '-bottom-1 -right-1',
};

const quantityPositionClass = computed(() => {
	const pos: QuantityPosition = config.value.quantityPosition ?? DEFAULT_QUANTITY_POSITION;
	return BADGE_POSITION_CLASSES[pos];
});

const highlanderPointsPositionClass = computed(() => {
	const pos: QuantityPosition = config.value.highlanderPointsPosition ?? DEFAULT_HIGHLANDER_POINTS_POSITION;
	return BADGE_POSITION_CLASSES[pos];
});

const quantityBadgeStyle = {
	color: modeTokenVar('deck', 'quantity-badge-text'),
	backgroundColor: modeTokenVar('deck', 'quantity-badge-surface'),
};

const highlanderPointBadgeStyle = {
	color: modeTokenVar('deck', 'points-badge-text'),
	backgroundColor: modeTokenVar('deck', 'points-badge-surface'),
};

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
		color: modeTokenVar('deck', 'meta-pill-text'),
		backgroundColor: modeTokenVar('deck', 'meta-pill-surface'),
		borderColor: modeTokenVar('deck', 'meta-pill-border'),
	};
});

const deckMetaAccentStyle = computed(() => {
	return showDeckMetaPill.value
		? {
				color: modeTokenVar('deck', 'meta-pill-accent'),
			}
		: primaryTextStyle;
});

const deckMetaTextStyle = computed(() => {
	return showDeckMetaPill.value
		? {
				color: modeTokenVar('deck', 'meta-pill-text'),
			}
		: secondaryTextStyle;
});

const highlanderPointedCardClass = computed((): string => {
	const size = config.value.highlanderPointedCardsSize ?? 'medium';
	return HIGHLANDER_POINTED_CARD_SIZE_CLASSES[size] || 'px-3 py-1 text-sm';
});

const highlanderPointedCardStyle = {
	color: modeTokenVar('deck', 'pointed-card-text'),
	backgroundColor: modeTokenVar('deck', 'pointed-card-surface'),
	borderColor: modeTokenVar('deck', 'pointed-card-border'),
};

const highlanderPointedCardAccentStyle = {
	color: modeTokenVar('deck', 'pointed-card-accent'),
};

const showQuantities = computed(() => config.value.showQuantities ?? false);

const cardBadgeProps = computed(() => ({
	showQuantity: showQuantities.value,
	showHighlanderPoints: showHighlanderPoints.value,
	quantityPositionClass: quantityPositionClass.value,
	quantitySizeClass: quantitySizeClass.value,
	quantityBadgeStyle,
	highlanderPointsPositionClass: highlanderPointsPositionClass.value,
	highlanderPointsSizeClass: highlanderPointBadgeClass.value,
	highlanderPointsBadgeStyle: highlanderPointBadgeStyle,
}));

/**
 * A stacked board: each card but the last shows only the `stack-reveal` Mode
 * Token's slice of itself, down a strip or across a row, and the next card
 * covers the rest. The last card shows whole.
 */
const STACK_REVEAL = modeTokenVar('deck', 'stack-reveal');

function stackColumnCardStyle(index: number, cardCount: number) {
	return index < cardCount - 1
		? { height: STACK_REVEAL }
		: {};
}

function stackRowCardStyle(index: number, cardCount: number) {
	return index < cardCount - 1
		? { width: STACK_REVEAL }
		: {};
}

const cardWidthStyle = {
	width: modeTokenVar('deck', 'card-width'),
};
</script>

<template>
	<ScreenModeBase
		:error="error"
	>
		<!-- Deck Content -->
		<div class="deck-content overflow-hidden w-full h-full" :style="displayStyle">
			<transition mode="out-in" name="deck-swap" @after-leave="handleDeckAfterLeave">
				<div v-if="showDeckBody && hasDisplayedDeck" :key="displayedDeckVersion" class="deck-body w-full h-full">
					<!-- Header -->
					<div v-if="showHeader" class="deck-header mb-4 text-center">
						<div
							v-if="showTopHeader"
							class="flex flex-wrap items-center justify-center gap-3"
						>
							<template v-if="config.showDeckName">
								<h2 class="text-xl" :style="titleStyle">
									{{ primaryHeader }}
								</h2>
								<p v-if="secondaryHeader" :style="secondaryTextStyle">
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
								<span :style="deckMetaTextStyle">Companion:</span>
								<span class="font-medium" :style="deckMetaAccentStyle">{{ companion.name }}</span>
							</div>

							<div v-if="deckCounters.length > 0" class="flex items-center gap-2">
								<span :style="deckMetaTextStyle">Counters:</span>
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
								:class="{ 'font-medium': showDeckMetaPill }"
								:style="showDeckMetaPill ? deckMetaAccentStyle : secondaryTextStyle"
							>
								{{ highlanderTotalLabel }}
							</p>

							<span
								v-for="stat in (config.showDeckStats ? deckStats : [])"
								:key="stat.type"
							>
								<span class="font-medium me-1" :style="deckMetaAccentStyle">{{ stat.count }}</span>
								<span :style="deckMetaTextStyle">{{ stat.type }}</span>
							</span>
						</div>

						<div v-if="showHighlanderPointedCards" class="mt-3 flex flex-wrap justify-center gap-2" data-testid="highlander-pointed-cards">
							<span
								v-for="card in highlanderPointedCardsList"
								:key="card.name"
								data-testid="highlander-pointed-card-chip"
								class="inline-flex items-center gap-1 rounded-full border leading-none"
								:class="highlanderPointedCardClass"
								:style="highlanderPointedCardStyle"
							>
								<span class="font-semibold" :style="highlanderPointedCardAccentStyle">{{ card.points }}</span>
								<span>{{ card.name }}</span>
								<span v-if="formatHighlanderPointedCardNote(card)" class="opacity-70">
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
							<h3 v-if="section.showLabel" class="text-lg mb-2" :style="titleStyle">
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
									:dynamic-size="section.layout.dynamicCardSize"
									v-bind="cardBadgeProps"
								/>
							</div>

							<!-- Stack, beside a mainboard: vertical strip -->
							<div
								v-else-if="section.layout.view === 'stack' && section.stackVertical"
								:data-testid="`${section.key}-stack-column`"
								class="stack-container flex flex-col"
								:style="cardWidthStyle"
							>
								<div
									v-for="(card, index) in section.cards"
									:key="`${section.key}-${index}`"
									class="stack-card relative shrink-0"
									:style="stackColumnCardStyle(index, section.cards.length)"
								>
									<ScreenModesDeckCard
										:card="card"
										v-bind="cardBadgeProps"
									/>
								</div>
							</div>

							<!-- Stack, full width: horizontal overlapping row -->
							<div v-else-if="section.layout.view === 'stack'" class="flex justify-center">
								<div
									:data-testid="`${section.key}-stack-row`"
									class="flex"
								>
									<div
										v-for="(card, index) in section.cards"
										:key="`${section.key}-${index}`"
										class="stack-card relative shrink-0"
										:style="stackRowCardStyle(index, section.cards.length)"
									>
										<ScreenModesDeckCard
											:card="card"
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
									<span class="quantity w-6 text-right" :style="secondaryTextStyle">
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
									<span class="type text-sm" :style="secondaryTextStyle">
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
