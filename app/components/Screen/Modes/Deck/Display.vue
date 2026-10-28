<script setup lang="ts">
import type { QuantityPosition } from '~~/shared/types/enums';
import type { ResolvedDeckBoardLayout } from '~~/shared/types/screenConfig';
import type { DeckLayout, DeckLayoutGridBoard, DeckLayoutStackBoard } from '~~/shared/utils/deckLayout';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { useElementSize } from '@vueuse/core';
import { DEFAULT_COMPANION_TAG_POSITION, DEFAULT_DECK_TEXT_SIZES, DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { solveDeckLayout } from '~~/shared/utils/deckLayout';
import { formatHighlanderPointedCardNote, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';
import { ninePointPlacement } from '~~/shared/utils/ninePoints';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';
import { CARD_BADGE_POSITION_CLASSES } from '~/utils/cardBadgePosition';

const {
	config,
	primaryHeader,
	secondaryHeader,
	deckColors,
	companionCard,
	highlander,
	deckStats,
	mainboard,
	sideboard,
	boardColumns,
	error,
	ready,
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
// stack renders as a grid (ADR-0054), keeping the stored view for when it
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

/** The companion shows as a card, never in the deck information: first among the sideboard's. */
const shownCompanion = computed(() => config.value.showCompanion !== false
	? companionCard.value
	: null);

/** The sideboard's cards, its companion first and not listed twice. */
const sideboardCards = computed(() => {
	const companion = shownCompanion.value;
	return companion
		? [
				companion,
				...sideboard.value.filter(card => card.name !== companion.name),
			]
		: sideboard.value;
});

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
			cards: sideboardCards.value,
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

// ── Fit: the whole deck at one card size ──
// When every board shown is Fit, the boards are laid out together from the
// space they really have (they have no pages to agree on): one card size, the
// largest at which both fit, with each board's columns chosen alongside the
// other's and a stacked sideboard showing less of each card before shrinking.
// Until that space is measured, each board fits itself.

/** The space between boards, in Event Canvas px: the layout's gap, set from this. */
const BOARD_GAP = 24;

// A board's label is measured, as its Theme types it, from a hidden copy.
const labelProbe = ref<HTMLElement | null>(null);
const boardLabelHeight = useLayoutHeight(labelProbe);

const layoutElement = ref<HTMLElement | null>(null);
const { width: layoutWidth, height: layoutHeight } = useElementSize(layoutElement);

function layoutBoard(section: VisibleBoard): DeckLayoutGridBoard | DeckLayoutStackBoard {
	const labelHeight = section.showLabel ? boardLabelHeight.value : 0;
	return section.view === 'stack'
		? {
				view: 'stack',
				count: section.cards.length,
				reveal: resolvedBoards.value.sideboard.stackReveal,
				labelHeight,
			}
		: {
				view: 'grid',
				count: section.cards.length,
				gap: section.layout.cardGap,
				columns: section.layout.autoColumns ? null : section.layout.columns,
				labelHeight,
			};
}

const solvedLayout = computed<DeckLayout | null>(() => {
	const boards = visibleBoards.value;
	if (boards.length === 0 || boards.some(section => !isFit(section) || section.view === 'list'))
		return null;
	const mainboard = boards.find(section => section.key === 'mainboard');
	const sideboard = boards.find(section => section.key === 'sideboard');
	return solveDeckLayout({
		width: layoutWidth.value,
		height: layoutHeight.value,
		boardGap: BOARD_GAP,
		placement: besideActive.value ? 'beside' : 'below',
		mainboard: mainboard
			? layoutBoard(mainboard) as DeckLayoutGridBoard
			: null,
		sideboard: sideboard
			? layoutBoard(sideboard)
			: null,
	});
});

function solvedBoard(section: VisibleBoard) {
	return solvedLayout.value?.[section.key] ?? null;
}

/** A grid's columns; a Fixed grid with auto columns fits as many as there is room for. */
function gridColumns(section: VisibleBoard): number | 'auto-fill' {
	const solved = solvedBoard(section);
	if (solved?.view === 'grid')
		return solved.columns;
	return !isFit(section) && section.layout.autoColumns
		? 'auto-fill'
		: boardColumns[section.key].value;
}

function gridRows(section: VisibleBoard): number {
	const solved = solvedBoard(section);
	if (solved?.view === 'grid')
		return solved.rows;
	return Math.max(1, Math.ceil(section.cards.length / boardColumns[section.key].value));
}

/** The one card width the solved deck uses, or none until its space is measured. */
const solvedCardWidth = computed(() => solvedLayout.value
	? `${solvedLayout.value.cardWidth}px`
	: undefined);

/**
 * A solved deck's boards fill the space they share. Across the axis they
 * share, each board sits at its own alignment, as far as the Screen's edge.
 * Along it they sit together at the mainboard's alignment, so the space they
 * leave is shared out around them, unless the sideboard's alignment points
 * away from the mainboard: then it goes to that far edge, and the mainboard
 * sits at its own alignment in the space before it (`boardFlexStyle`).
 */
const solvedPlacement = computed(() => {
	const along = (key: 'mainboard' | 'sideboard') => {
		const { x, y } = ninePointPlacement(resolvedBoards.value[key].alignment);
		return besideActive.value ? x : y;
	};
	const mainboard = along(showMainboard.value ? 'mainboard' : 'sideboard');
	const sideboardToEdge = showMainboard.value && showSideboard.value && along('sideboard') === 'end' && mainboard !== 'end';
	return { mainboard, sideboardToEdge };
});

const solvedLayoutStyle = computed(() => {
	if (!solvedLayout.value || solvedPlacement.value.sideboardToEdge)
		return undefined;
	return { justifyContent: solvedPlacement.value.mainboard };
});

/** A solved board's label lines up with the edge its board sits at. */
function labelStyle(section: VisibleBoard) {
	if (!solvedLayout.value)
		return titleStyle;
	const { x } = ninePointPlacement(section.layout.alignment);
	return {
		...titleStyle,
		textAlign: x === 'start'
			? 'left' as const
			: x === 'end'
				? 'right' as const
				: 'center' as const,
	};
}

/**
 * In the beside row each board's share of the width follows its column count,
 * so a column reads about the same width on either side. A Fixed beside stack
 * stays content-sized, its strip at its card width; a Fit one is one column
 * wide. Boards below each other share the height a Fit grid needs by its rows,
 * and anything else takes its own height. A solved deck gives every board
 * exactly its size, and the boards are placed together (`solvedLayoutStyle`).
 */
function boardFlexStyle(section: VisibleBoard) {
	const solved = solvedBoard(section);
	if (solved) {
		// Across the shared axis, each board sits at its own alignment: up and
		// down beside the other, across below it. A sideboard sent to the far
		// edge takes the space before it, which a centred mainboard shares.
		const { x, y } = ninePointPlacement(section.layout.alignment);
		const { mainboard, sideboardToEdge } = solvedPlacement.value;
		const leading = besideActive.value ? 'marginLeft' : 'marginTop';
		const pushed = sideboardToEdge && (section.key === 'sideboard' || mainboard === 'center');
		return {
			flex: 'none',
			width: `${solved.width}px`,
			height: `${solved.height}px`,
			alignSelf: besideActive.value ? y : x,
			...(pushed
				? { [leading]: 'auto' }
				: {}),
		};
	}
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
// The header's two lines, each its own choice: who (the Player, or a list's
// name) and what (the deck's name, or a list's archetype).
const showPlayerName = computed(() => config.value.showPlayerName !== false && !!primaryHeader.value);
const showDeckName = computed(() => config.value.showDeckName !== false && !!secondaryHeader.value);
const showDeckColors = computed(() => config.value.showDeckColors !== false && !!deckColors.value);
const showTopHeader = computed(() => showPlayerName.value || showDeckName.value || showDeckColors.value);
const showDeckMeta = computed(() =>
	(config.value.showDeckStats && deckStats.value.length > 0)
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

const quantityPositionClass = computed(() => {
	const pos: QuantityPosition = config.value.quantityPosition ?? DEFAULT_QUANTITY_POSITION;
	return CARD_BADGE_POSITION_CLASSES[pos];
});

const highlanderPointsPositionClass = computed(() => {
	const pos: QuantityPosition = config.value.highlanderPointsPosition ?? DEFAULT_HIGHLANDER_POINTS_POSITION;
	return CARD_BADGE_POSITION_CLASSES[pos];
});

/** The companion's tag is placed as the other badges are: in a corner, its own edge sits there. */
const companionTagPositionClass = computed(() =>
	CARD_BADGE_POSITION_CLASSES[config.value.companionTagPosition ?? DEFAULT_COMPANION_TAG_POSITION]);

// Each badge, pill and chip sizes itself around its text, whose size is the
// Screen's own config (ADR-0054), keeping the proportions its former medium size had.

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

/** The deck details row's text size applies with or without its pill. */
const deckMetaPillStyle = computed(() => {
	if (!showDeckMetaPill.value) {
		return {
			fontSize: textSize('metaPillSize'),
		};
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
	tagPositionClass: companionTagPositionClass.value,
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
/** The strip places its stack at its board's alignment, or from its start once the stack overflows. */
function stackAlignmentStyle(section: VisibleBoard) {
	const { x, y } = ninePointPlacement(section.layout.alignment);
	return { alignItems: `safe ${x}`, justifyContent: `safe ${y}` };
}

function stackCardStyle(section: VisibleBoard, index: number) {
	const solved = solvedBoard(section);
	if (solved?.view === 'stack') {
		return {
			...(index < section.cards.length - 1
				? { height: `${solved.reveal}px` }
				: {}),
			width: `${solved.width}px`,
		};
	}
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
		:ready="ready"
	>
		<!-- Deck Content -->
		<div class="deck-content w-full h-full" :style="displayStyle">
			<transition mode="out-in" name="deck-swap" @after-leave="handleDeckAfterLeave">
				<div v-if="showDeckBody && hasDisplayedDeck" :key="displayedDeckVersion" class="deck-body relative flex flex-col w-full h-full">
					<!-- Header -->
					<div v-if="showHeader" class="deck-header shrink-0 mb-4 text-center">
						<div
							v-if="showTopHeader"
							class="flex flex-wrap items-center justify-center gap-3"
						>
							<h2
								v-if="showPlayerName"
								data-testid="deck-player-name"
								class="text-xl"
								:style="titleStyle"
							>
								{{ primaryHeader }}
							</h2>
							<p v-if="showDeckName" data-testid="deck-name" :style="secondaryTextStyle">
								{{ secondaryHeader }}
							</p>

							<MtgManaColorDisplay v-if="showDeckColors" :colors="deckColors" size="lg" />
						</div>

						<div
							v-if="showDeckMeta"
							data-testid="deck-meta-pill"
							class="mt-3 flex flex-wrap items-center justify-center border"
							:class="showDeckMetaPill ? 'inline-flex rounded-full' : ['gap-x-4 gap-y-1 border-transparent px-0 py-0']"
							:style="deckMetaPillStyle"
						>
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
					<!-- A board label as the Theme types it, measured for the layout. -->
					<div ref="labelProbe" aria-hidden="true" class="invisible absolute pointer-events-none">
						<h3 class="text-lg pb-2" :style="titleStyle">
							Sideboard
						</h3>
					</div>

					<!-- The space the boards share, and in it the boards. -->
					<div
						ref="layoutElement"
						class="deck-layout-space flex flex-1 min-h-0"
					>
						<div
							class="deck-layout flex flex-1 min-h-0 min-w-0"
							:class="besideActive ? 'flex-row' : 'flex-col'"
							:style="[{ gap: `${BOARD_GAP}px` }, solvedLayoutStyle]"
						>
							<div
								v-for="section in visibleBoards"
								:key="section.key"
								:data-testid="`${section.key}-section`"
								class="flex flex-col min-h-0 min-w-0"
								:style="boardFlexStyle(section)"
							>
								<h3 v-if="section.showLabel" class="text-lg shrink-0 pb-2" :style="labelStyle(section)">
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
									:alignment="section.layout.alignment"
									:fit-card-width="solvedCardWidth"
								>
									<ScreenModesDeckCard
										v-for="(card, index) in section.cards"
										:key="`${section.key}-${index}`"
										:card="card"
										:tag="card === shownCompanion ? 'Companion' : undefined"
										:width="cardWidth(section)"
										:sizing="section.layout.cardSizing"
										v-bind="cardBadgeProps"
									/>
								</ScreenCardGrid>

								<!-- Stack, beside a mainboard: vertical strip -->
								<div
									v-else-if="section.view === 'stack'"
									:data-testid="`${section.key}-stack-column`"
									class="stack-container flex flex-col flex-1 min-h-0"
									:class="{ 'stack-container--fit': isFit(section) }"
									:style="stackAlignmentStyle(section)"
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
											:tag="card === shownCompanion ? 'Companion' : undefined"
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

							<!-- With no sideboard shown, the companion takes a column of its own. -->
							<div
								v-if="shownCompanion && !showSideboard"
								data-testid="companion-section"
								class="shrink-0 flex flex-col"
							>
								<ScreenModesDeckCard
									:card="shownCompanion"
									tag="Companion"
									:width="`${resolvedBoards.sideboard.cardWidth}px`"
									sizing="fixed"
									v-bind="cardBadgeProps"
									:show-quantity="false"
								/>
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
	container-type: size;
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
