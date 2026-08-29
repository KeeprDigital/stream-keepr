<script setup lang="ts">
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import type { ScreenConfig } from '~~/shared/types/screenConfig';

const { screen } = useScreenContext();

const { config, error, isEmpty, headerText, entries } = useTopCardsModeData();

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);
const primaryTextStyle = computed(() => {
	return screenConfig.value.primaryTextColor
		? { color: screenConfig.value.primaryTextColor }
		: {};
});

const gridStyle = computed(() => ({
	gridTemplateColumns: config.value.dynamicCardSize
		? `repeat(${config.value.columns}, minmax(0, 1fr))`
		: `repeat(${config.value.columns}, max-content)`,
	gap: `${config.value.cardGap}px`,
	justifyContent: config.value.dynamicCardSize ? undefined : 'center',
}));

const cardSizeClass = computed(() => {
	switch (config.value.cardSize) {
		case 'small': return 'w-28';
		case 'large': return 'w-52';
		default: return 'w-40';
	}
});

const rankBadgeClass = computed(() => {
	const base = 'top-1 left-1';
	switch (config.value.statBadgeSize ?? 'medium') {
		case 'small': return `${base} w-5 h-5 text-xs`;
		case 'large': return `${base} w-8 h-8 text-base`;
		default: return `${base} w-6 h-6 text-sm`;
	}
});

const statBadgeClass = computed(() => {
	const base = 'bottom-1 right-1';
	switch (config.value.statBadgeSize ?? 'medium') {
		case 'small': return `${base} text-xs px-1.5 py-0.5`;
		case 'large': return `${base} text-base px-2.5 py-1.5`;
		default: return `${base} text-sm px-2 py-1`;
	}
});

const rankBadgeStyle = computed(() => ({
	color: config.value.rankBadgeTextColor ?? '#ffffff',
	backgroundColor: config.value.rankBadgeBgColor ?? '#7c3aed',
}));

const statBadgeStyle = computed(() => ({
	color: config.value.statBadgeTextColor ?? '#111827',
	backgroundColor: config.value.statBadgeBgColor ?? '#ffffff',
}));

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
		<div class="top-cards-display flex flex-col gap-4 h-full w-full">
			<div v-if="config.showHeader" class="top-cards-title">
				<h2 class="text-3xl font-bold" :style="primaryTextStyle">
					{{ headerText }}
				</h2>
			</div>

			<div
				class="top-cards-grid grid"
				:style="gridStyle"
				data-testid="top-cards-grid"
			>
				<ScreenModesTopCardsCard
					v-for="(entry, index) in entries"
					:key="entry.id"
					:entry="entry"
					:rank="index + 1"
					:size-class="cardSizeClass"
					:dynamic-size="config.dynamicCardSize"
					:show-name="config.showCardNames"
					:show-rank="config.showRankBadges"
					:rank-badge-class="rankBadgeClass"
					:rank-badge-style="rankBadgeStyle"
					:stat-text="statText(entry)"
					:stat-badge-class="statBadgeClass"
					:stat-badge-style="statBadgeStyle"
				/>
			</div>
		</div>
	</ScreenModeBase>
</template>
