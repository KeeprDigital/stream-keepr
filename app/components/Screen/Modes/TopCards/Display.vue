<script setup lang="ts">
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import { useElementSize } from '@vueuse/core';
import { cardBadgeTextSize, TOP_CARDS_AUTO_BADGE_RATIO } from '~~/shared/utils/cardBadgeSize';
import { solveCardGrid } from '~~/shared/utils/cardGrid';
import { foundationTokenVar, foundationTypographyStyle, modeTokenVar } from '~/modules/screen-mode';
import { CARD_BADGE_POSITION_CLASSES } from '~/utils/cardBadgePosition';

const { config, error, ready, isEmpty, headerText, pageEntries, currentPage, totalPages, pageCapacity } = useTopCardsModeData(useScreenContext());

// ── The Card Layout, from the space the grid really has ──
// Pages hold cards, not rows (ADR-0054), so the Screen solves its grid from the
// space it measures: the largest card at which a full page fits, in its set
// columns or the count that uses the space best, no wider than its max card
// size. A short last page is laid out as a full one, so it keeps its card size.

const gridElement = ref(null);
const { width: gridWidth, height: gridHeight } = useElementSize(gridElement);

const grid = computed(() => solveCardGrid({
	count: pageCapacity.value,
	width: gridWidth.value,
	height: gridHeight.value,
	columns: config.value.columns,
	maxCardWidth: config.value.maxCardSize,
	gap: config.value.cardGap,
}));
const cardGap = computed(() => `${grid.value.gap}px`);
const cardWidth = computed(() => `${grid.value.cardWidth}px`);

/** Set on the root, so a card without an image takes it. */
const displayStyle = {
	...foundationTypographyStyle('body'),
	color: foundationTokenVar('text-primary'),
};
const titleStyle = {
	...foundationTypographyStyle('heading'),
	color: foundationTokenVar('text-primary'),
};
/** Over the shared page indicator's own face. */
const pageIndicatorStyle = {
	...foundationTypographyStyle('body'),
	color: foundationTokenVar('text-secondary'),
};

/** A badge lifts off the card's art on a soft shadow. */
const badgeStyle = {
	...foundationTypographyStyle('heading'),
	boxShadow: `0 4px 6px -1px ${foundationTokenVar('shadow')}`,
};

// Each badge sits where its config places it, and sizes itself around its own
// text size: set in px, or Auto, a share of the solved card width.
function badgeTextSize(size: number | undefined): string {
	return `${cardBadgeTextSize(size, grid.value.cardWidth, TOP_CARDS_AUTO_BADGE_RATIO)}px`;
}

const rankBadgeClass = computed(() => CARD_BADGE_POSITION_CLASSES[config.value.rankBadgePosition]);
const statBadgeClass = computed(() => CARD_BADGE_POSITION_CLASSES[config.value.statBadgePosition]);
const pointsBadgeClass = computed(() => CARD_BADGE_POSITION_CLASSES[config.value.pointsBadgePosition]);

const rankBadgeStyle = computed(() => ({
	...badgeStyle,
	fontSize: badgeTextSize(config.value.rankBadgeTextSize),
	width: '1.75em',
	height: '1.75em',
	color: modeTokenVar('top-cards', 'rank-badge-text'),
	backgroundColor: modeTokenVar('top-cards', 'rank-badge-surface'),
}));

const statBadgeStyle = computed(() => ({
	...badgeStyle,
	fontSize: badgeTextSize(config.value.statBadgeTextSize),
	padding: '0.3em 0.6em',
	color: modeTokenVar('top-cards', 'stat-badge-text'),
	backgroundColor: modeTokenVar('top-cards', 'stat-badge-surface'),
}));

const pointsBadgeStyle = computed(() => ({
	...badgeStyle,
	fontSize: badgeTextSize(config.value.pointsBadgeTextSize),
	padding: '0.3em 0.6em',
	color: modeTokenVar('top-cards', 'points-badge-text'),
	backgroundColor: modeTokenVar('top-cards', 'points-badge-surface'),
}));

const cardStyle = {
	backgroundColor: foundationTokenVar('surface-raised'),
};

function statText(entry: CardBreakdownEntry): string | null {
	switch (config.value.statBadge) {
		case 'inclusionRate': return `${entry.inclusionRate}%`;
		case 'avgCopies': return `${entry.avgCopies}`;
		case 'totalCopies': return `${entry.totalCopies}`;
		case 'deckCount': return `${entry.deckCount}`;
		default: return null;
	}
}

/** Only a pointed card has points; a card the Event's points system leaves out shows none. */
function pointsText(entry: CardBreakdownEntry): string | null {
	return config.value.showPointsBadges && entry.highlanderPoints != null
		? `${entry.highlanderPoints}`
		: null;
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:ready="ready"
		:empty="isEmpty"
	>
		<div class="top-cards-display relative flex flex-col gap-4 h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="top-cards-title">
				<h2 class="text-3xl" :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<ScreenCardGrid
				ref="gridElement"
				class="top-cards-grid"
				:columns="grid.columns"
				:rows="grid.rows"
				:card-width="cardWidth"
				:gap="cardGap"
				data-testid="top-cards-grid"
			>
				<ScreenModesTopCardsCard
					v-for="{ entry, rank } in pageEntries"
					:key="entry.id"
					:entry="entry"
					:rank="rank"
					sizing="fill"
					:show-name="false"
					:show-rank="config.showRankBadges"
					:rank-badge-class="rankBadgeClass"
					:rank-badge-style="rankBadgeStyle"
					:stat-text="statText(entry)"
					:stat-badge-class="statBadgeClass"
					:stat-badge-style="statBadgeStyle"
					:points-text="pointsText(entry)"
					:points-badge-class="pointsBadgeClass"
					:points-badge-style="pointsBadgeStyle"
					:card-style="cardStyle"
				/>
			</ScreenCardGrid>

			<div
				v-if="totalPages > 1"
				class="broadcast-table-page-indicator"
				:style="pageIndicatorStyle"
				data-testid="top-cards-page-indicator"
			>
				{{ currentPage }} / {{ totalPages }}
			</div>
		</div>
	</ScreenModeBase>
</template>
