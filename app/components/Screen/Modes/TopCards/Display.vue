<script setup lang="ts">
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import { useElementSize } from '@vueuse/core';
import { fitColumns } from '~~/shared/utils/cardGrid';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { config, error, isEmpty, headerText, pageEntries, currentPage, totalPages, pageCapacity } = useTopCardsModeData();

// ── Columns, from the space the grid really has ──
// Pages hold cards, not rows (ADR-0053), so the Screen chooses its columns from
// the space it measures: Fit auto columns are the count at which a full page's
// cards are largest; Fixed auto columns are as many as fit across.

/** A name label's height under its card, as Fit sizing allows for it: its line and `gap-1`. */
const NAME_LABEL_HEIGHT = 28;

const gridElement = ref(null);
const { width: gridWidth, height: gridHeight } = useElementSize(gridElement);

const columns = computed<number | 'auto-fill'>(() => {
	if (!config.value.autoColumns)
		return config.value.columns;
	if (config.value.cardSizing === 'fixed')
		return 'auto-fill';
	if (!gridWidth.value || !gridHeight.value)
		return config.value.columns;
	return fitColumns({
		count: pageCapacity.value,
		width: gridWidth.value,
		height: gridHeight.value,
		gap: config.value.cardGap,
		labelHeight: config.value.showCardNames ? NAME_LABEL_HEIGHT : 0,
	});
});

/** A full page's rows, so a short last page keeps the same card size. */
const rows = computed(() => Math.ceil(pageCapacity.value / (typeof columns.value === 'number'
	? columns.value
	: 1)));

/** Set on the root, so card names and a card without an image take it. */
const displayStyle = {
	...modeTypographyStyle('top-cards', 'name-typography'),
	color: modeTokenVar('top-cards', 'name-text'),
};
const titleStyle = {
	...modeTypographyStyle('top-cards', 'title-typography'),
	color: modeTokenVar('top-cards', 'title-text'),
};
/** Over the shared page indicator's own face. */
const pageIndicatorStyle = {
	...modeTypographyStyle('top-cards', 'name-typography'),
	color: modeTokenVar('top-cards', 'page-indicator-text'),
};

// Its sizes are its own config, in Event Canvas px (ADR-0053).
const cardGap = computed(() => `${config.value.cardGap}px`);
const cardWidth = computed(() => `${config.value.cardWidth}px`);
/** The badges' text size, which each badge sizes itself around. */
const badgeSize = computed(() => `${config.value.badgeSize}px`);

/** A badge lifts off the card's art on a soft shadow. */
const badgeStyle = {
	...modeTypographyStyle('top-cards', 'badge-typography'),
	boxShadow: `0 4px 6px -1px ${modeTokenVar('top-cards', 'badge-shadow')}`,
};

const rankBadgeStyle = {
	...badgeStyle,
	width: '1.75em',
	height: '1.75em',
	color: modeTokenVar('top-cards', 'rank-badge-text'),
	backgroundColor: modeTokenVar('top-cards', 'rank-badge-surface'),
};

const statBadgeStyle = {
	...badgeStyle,
	padding: '0.3em 0.6em',
	color: modeTokenVar('top-cards', 'stat-badge-text'),
	backgroundColor: modeTokenVar('top-cards', 'stat-badge-surface'),
};

const cardStyle = {
	backgroundColor: modeTokenVar('top-cards', 'card-placeholder-surface'),
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
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="top-cards-display flex flex-col gap-4 h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="top-cards-title">
				<h2 class="text-3xl" :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<ScreenCardGrid
				ref="gridElement"
				class="top-cards-grid"
				:sizing="config.cardSizing"
				:columns="columns"
				:rows="rows"
				:card-width="cardWidth"
				:gap="cardGap"
				:label-height="config.showCardNames ? 'calc(1lh + 0.25rem)' : '0px'"
				data-testid="top-cards-grid"
			>
				<ScreenModesTopCardsCard
					v-for="{ entry, rank } in pageEntries"
					:key="entry.id"
					:entry="entry"
					:rank="rank"
					:width="cardWidth"
					:sizing="config.cardSizing"
					:show-name="config.showCardNames"
					:show-rank="config.showRankBadges"
					rank-badge-class="top-1 left-1"
					:rank-badge-style="rankBadgeStyle"
					:stat-text="statText(entry)"
					stat-badge-class="bottom-1 right-1"
					:stat-badge-style="statBadgeStyle"
					:badge-size="badgeSize"
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
