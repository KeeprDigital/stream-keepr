<script setup lang="ts">
import type { QuantityPosition } from '~~/shared/types/enums';
import type { ResolvedDeckBoardLayout } from '~~/shared/types/screenConfig';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
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
	boardColumns,
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

// A sideboard stacks only as the strip beside a mainboard; anywhere else its
// stack renders as a grid (ADR-0053), keeping the stored view for when it
// moves back beside.
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
	/** The view it renders, which is its layout's, unless a stack cannot stack here. */
	view: 'grid' | 'stack' | 'list';
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
			view: resolvedBoards.value.mainboard.view,
			showLabel: resolvedBoards.value.mainboard.view === 'list',
		});
	}
	if (showSideboard.value) {
		const { view } = resolvedBoards.value.sideboard;
		boards.push({
			key: 'sideboard',
			label: 'Sideboard',
			cards: sideboard.value,
			layout: resolvedBoards.value.sideboard,
			view: view === 'stack' && !sideboardBeside.value
				? 'grid'
				: view,
			showLabel: true,
		});
	}
	return boards;
});

const besideActive = computed(() => sideboardBeside.value && showMainboard.value);

function isFit(section: VisibleBoard): boolean {
	return section.layout.cardSizing === 'fit';
}

/** A grid's columns; a Fixed grid with auto columns fits as many as there is room for. */
function gridColumns(section: VisibleBoard): number | 'auto-fill' {
	return !isFit(section) && section.layout.autoColumns
		? 'auto-fill'
		: boardColumns[section.key].value;
}

function gridRows(section: VisibleBoard): number {
	return Math.max(1, Math.ceil(section.cards.length / boardColumns[section.key].value));
}

/**
 * In the beside row each board's share of the width follows its column count,
 * so a column reads about the same width on either side. A Fixed beside stack
 * stays content-sized, its strip at its card width; a Fit one is one column
 * wide. Boards below each other share the height a Fit grid needs by its rows,
 * and anything else takes its own height.
 */
function boardFlexStyle(section: VisibleBoard) {
	if (!besideActive.value) {
		return isFit(section) && section.view === 'grid'
			? { flex: `${gridRows(section)} 1 0%` }
			: { flex: 'none' };
	}
	if (section.view === 'stack') {
		return isFit(section)
			? { flex: '1 1 0%' }
			: {};
	}
	const weight = section.view === 'list'
		? section.layout.listColumns
		: boardColumns[section.key].value;
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

// Each badge, pill and chip sizes itself around its text, whose size is the
// Screen's own config (ADR-0053), keeping the proportions its former medium size had.

/** One text size in px, the Screen's or its default. */
function textSize(key: keyof typeof DEFAULT_DECK_TEXT_SIZES): string {
	return `${config.value[key] ?? DEFAULT_DECK_TEXT_SIZES[key]}px`;
}

const quantityBadgeStyle = computed(() => ({
	fontSize: textSize('quantityBadgeSize'),
	width: '1.75em',
	height: '1.75em',
	color: modeTokenVar('deck', 'quantity-badge-text'),
	backgroundColor: modeTokenVar('deck', 'quantity-badge-surface'),
}));

const highlanderPointBadgeStyle = computed(() => ({
	fontSize: textSize('pointsBadgeSize'),
	minWidth: '2em',
	padding: '0.3em 0.7em',
	color: modeTokenVar('deck', 'points-badge-text'),
	backgroundColor: modeTokenVar('deck', 'points-badge-surface'),
}));

/** A point badge lifts off a card's art on a soft shadow, and off a list row on a slighter one. */
const highlanderCardBadgeStyle = computed(() => ({
	...highlanderPointBadgeStyle.value,
	boxShadow: `0 4px 6px -1px ${modeTokenVar('deck', 'badge-shadow')}`,
}));
const highlanderListBadgeStyle = computed(() => ({
	...highlanderPointBadgeStyle.value,
	boxShadow: `0 1px 3px 0 ${modeTokenVar('deck', 'badge-shadow')}`,
}));

const deckMetaPillStyle = computed(() => {
	if (!showDeckMetaPill.value) {
		return {};
	}

	return {
		fontSize: textSize('metaPillSize'),
		padding: '0.5em 1.25em',
		gap: '0.375em 1em',
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

const highlanderPointedCardStyle = computed(() => ({
	fontSize: textSize('pointedCardSize'),
	padding: '0.3em 0.85em',
	color: modeTokenVar('deck', 'pointed-card-text'),
	backgroundColor: modeTokenVar('deck', 'pointed-card-surface'),
	borderColor: modeTokenVar('deck', 'pointed-card-border'),
}));

const highlanderPointedCardAccentStyle = {
	color: modeTokenVar('deck', 'pointed-card-accent'),
};

const showQuantities = computed(() => config.value.showQuantities ?? false);

const cardBadgeProps = computed(() => ({
	showQuantity: showQuantities.value,
	showHighlanderPoints: showHighlanderPoints.value,
	quantityPositionClass: quantityPositionClass.value,
	quantityBadgeStyle: quantityBadgeStyle.value,
	highlanderPointsPositionClass: highlanderPointsPositionClass.value,
	highlanderPointsBadgeStyle: highlanderCardBadgeStyle.value,
}));

const stackReveal = computed(() => `${resolvedBoards.value.sideboard.stackReveal}px`);

/** A board's card width, in px. */
function cardWidth(section: VisibleBoard): string {
	return `${section.layout.cardWidth}px`;
}

/**
 * The beside stack: each card but the last shows only its `stackReveal`
 * slice of itself down the strip, and the next card covers the
 * rest. The last card shows whole. In Fit, every card takes the width at which
 * the whole strip, reveals and last card, fits the strip's height.
 */
function stackCardStyle(section: VisibleBoard, index: number) {
	return {
		...(index < section.cards.length - 1
			? { height: stackReveal.value }
			: {}),
		...(isFit(section)
			? { width: `min(100cqw, calc((100cqh - ${section.cards.length - 1} * ${stackReveal.value}) * 61 / 85))` }
			: {}),
	};
}
</script>

<template>
	<ScreenModeBase
		:error="error"
	>
		<!-- Deck Content -->
		<div class="deck-content overflow-hidden w-full h-full" :style="displayStyle">
			<transition mode="out-in" name="deck-swap" @after-leave="handleDeckAfterLeave">
				<div v-if="showDeckBody && hasDisplayedDeck" :key="displayedDeckVersion" class="deck-body flex flex-col w-full h-full">
					<!-- Header -->
					<div v-if="showHeader" class="deck-header shrink-0 mb-4 text-center">
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
							:class="showDeckMetaPill ? 'inline-flex rounded-full' : ['gap-x-4 gap-y-1 text-sm border-transparent px-0 py-0']"
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
					<div class="deck-layout flex flex-1 min-h-0 gap-6" :class="besideActive ? 'flex-row' : 'flex-col'">
						<div
							v-for="section in visibleBoards"
							:key="section.key"
							:data-testid="`${section.key}-section`"
							class="flex flex-col min-h-0 min-w-0"
							:style="boardFlexStyle(section)"
						>
							<h3 v-if="section.showLabel" class="text-lg shrink-0 mb-2" :style="titleStyle">
								{{ section.label }}
							</h3>

							<!-- Grid -->
							<ScreenCardGrid
								v-if="section.view === 'grid'"
								:data-testid="`${section.key}-grid`"
								:sizing="section.layout.cardSizing"
								:columns="gridColumns(section)"
								:rows="gridRows(section)"
								:card-width="cardWidth(section)"
								:gap="`${section.layout.cardGap}px`"
							>
								<ScreenModesDeckCard
									v-for="(card, index) in section.cards"
									:key="`${section.key}-${index}`"
									:card="card"
									:width="cardWidth(section)"
									:sizing="section.layout.cardSizing"
									v-bind="cardBadgeProps"
								/>
							</ScreenCardGrid>

							<!-- Stack, beside a mainboard: vertical strip -->
							<div
								v-else-if="section.view === 'stack'"
								:data-testid="`${section.key}-stack-column`"
								class="stack-container flex flex-col"
								:class="{ 'stack-container--fit': isFit(section) }"
								:data-card-sizing="section.layout.cardSizing"
							>
								<div
									v-for="(card, index) in section.cards"
									:key="`${section.key}-${index}`"
									class="stack-card relative shrink-0"
									:style="stackCardStyle(section, index)"
								>
									<ScreenModesDeckCard
										:card="card"
										:width="cardWidth(section)"
										:sizing="isFit(section) ? 'fill' : 'fixed'"
										v-bind="cardBadgeProps"
									/>
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
										class="rounded-md font-bold tabular-nums leading-none"
										:style="highlanderListBadgeStyle"
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
.card-list {
	display: grid;
}

/* The strip's own height and width are what its cards fit (`stackCardStyle`). */
.stack-container--fit {
	flex: 1 1 0%;
	min-height: 0;
	container-type: size;
	align-items: center;
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
