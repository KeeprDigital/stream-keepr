<script setup lang="ts">
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const {
	config,
	error,
	isEmpty,
	headerText,
	conversionLabel,
	spotlight,
	pageData,
	topCards,
	currentPage,
	totalPages,
	formatRecord,
} = useArchetypeSpotlightModeData();

const primaryTextStyle = {
	color: modeTokenVar('archetype-spotlight', 'primary-text'),
};
const secondaryTextStyle = {
	color: modeTokenVar('archetype-spotlight', 'secondary-text'),
};
const titleStyle = {
	...modeTypographyStyle('archetype-spotlight', 'title-typography'),
	color: modeTokenVar('archetype-spotlight', 'title-text'),
};
const titleDividerStyle = {
	borderBottomColor: modeTokenVar('archetype-spotlight', 'title-divider'),
};
const headlineStyle = {
	...modeTypographyStyle('archetype-spotlight', 'headline-typography'),
	...primaryTextStyle,
};
const labelStyle = {
	...modeTypographyStyle('archetype-spotlight', 'label-typography'),
	...secondaryTextStyle,
};
/** Over the shared header row's own face, colour and rule. */
const columnHeaderStyle = {
	...labelStyle,
	borderBottomColor: modeTokenVar('archetype-spotlight', 'row-divider'),
};
/** On each row too, over the shared row chrome's own line height. */
const rowStyle = {
	...modeTypographyStyle('archetype-spotlight', 'row-typography'),
	borderBottomColor: modeTokenVar('archetype-spotlight', 'row-divider'),
};
/** Over the shared page indicator's own face. */
const pageIndicatorStyle = {
	...modeTypographyStyle('archetype-spotlight', 'row-typography'),
	...secondaryTextStyle,
};
const surfaceStyle = {
	backgroundColor: modeTokenVar('archetype-spotlight', 'surface'),
};

/** Set on the root, over the shared broadcast table chrome's own colour and face. */
const displayStyle = {
	...modeTypographyStyle('archetype-spotlight', 'row-typography'),
	color: modeTokenVar('archetype-spotlight', 'primary-text'),
};

// The archetype page's stat strip, for the numbers a spotlight shows.
const stats = computed(() => {
	const data = spotlight.value;
	if (!data)
		return [];
	return [
		{
			label: 'Pilots',
			value: String(data.playerCount),
		},
		{ label: 'Meta Share', value: `${data.metaShare}%` },
		{
			label: `Conversion (${conversionLabel.value})`,
			value: data.conversionRate != null && data.convertedCount != null
				? `${data.conversionRate}% (${data.convertedCount}/${data.playerCount})`
				: '-',
		},
	];
});

// Cards carry no rank badge here: their order is the ranking. The face is
// set over the card's own.
const statBadgeStyle = {
	...modeTypographyStyle('archetype-spotlight', 'row-typography'),
	color: modeTokenVar('archetype-spotlight', 'stat-badge-text'),
	backgroundColor: modeTokenVar('archetype-spotlight', 'stat-badge-surface'),
};
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="archetype-spotlight-display broadcast-table-display flex flex-col gap-4 h-full w-full" :style="displayStyle">
			<div v-if="config.showHeader" class="spotlight-header broadcast-table-title" :style="titleDividerStyle">
				<h2 :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<div v-if="spotlight" class="spotlight-summary flex items-center justify-between gap-6 px-4">
				<div class="flex items-center gap-3 min-w-0">
					<span class="spotlight-name truncate" :style="headlineStyle">{{ spotlight.archetype.name }}</span>
					<MtgManaColorDisplay
						v-if="spotlight.archetype.colors"
						:colors="spotlight.archetype.colors"
						size="lg"
						:cost="true"
					/>
				</div>
				<div class="flex gap-8">
					<div v-for="stat in stats" :key="stat.label" class="spotlight-stat flex flex-col items-end">
						<span class="stat-label" :style="labelStyle">{{ stat.label }}</span>
						<span class="stat-value" :style="headlineStyle">{{ stat.value }}</span>
					</div>
				</div>
			</div>

			<div class="spotlight-body flex gap-6 flex-1 min-h-0 px-4">
				<div class="spotlight-pilots broadcast-table-surface" :style="surfaceStyle">
					<div class="pilot-grid broadcast-table-header-row" :style="columnHeaderStyle">
						<span>#</span>
						<span>Pilot</span>
						<span class="text-right">Record</span>
					</div>
					<div
						v-for="pilot in pageData"
						:key="pilot.id"
						class="pilot-row pilot-grid broadcast-table-row"
						:style="rowStyle"
					>
						<span class="pilot-position" :style="secondaryTextStyle">{{ pilot.position ?? '-' }}</span>
						<span class="pilot-name truncate" :style="primaryTextStyle">{{ pilot.name }}</span>
						<span class="pilot-record text-right" :style="primaryTextStyle">{{ formatRecord(pilot) }}</span>
					</div>
					<div
						v-if="totalPages > 1"
						class="broadcast-table-page-indicator"
						:style="pageIndicatorStyle"
					>
						{{ currentPage }} / {{ totalPages }}
					</div>
				</div>

				<div v-if="topCards.length > 0" class="spotlight-cards">
					<ScreenModesTopCardsCard
						v-for="(entry, index) in topCards"
						:key="entry.id"
						:entry="entry"
						:rank="index + 1"
						size-class=""
						:dynamic-size="true"
						:show-name="true"
						:show-rank="false"
						rank-badge-class=""
						:rank-badge-style="{}"
						:stat-text="`${entry.inclusionRate}%`"
						stat-badge-class="bottom-1 right-1 text-sm px-2 py-1"
						:stat-badge-style="statBadgeStyle"
					/>
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.spotlight-name {
	font-size: clamp(1.5rem, 3cqw, 2.75rem);
}
.stat-label {
	font-size: 0.8rem;
}
.stat-value {
	font-size: clamp(1.25rem, 2.4cqw, 2.25rem);
	font-variant-numeric: tabular-nums;
}
.spotlight-pilots {
	flex: 1 1 45%;
}
.pilot-grid {
	display: grid;
	grid-template-columns: 3.5rem minmax(0, 1fr) auto;
	gap: 1rem;
	align-items: center;
	padding: 0.6rem 0.5rem;
	font-size: clamp(1rem, 1.8cqw, 1.6rem);
}
.pilot-row {
	border-bottom-style: solid;
	border-bottom-width: 1px;
}
.pilot-position,
.pilot-record {
	font-variant-numeric: tabular-nums;
}
.spotlight-cards {
	flex: 1 1 55%;
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	align-content: start;
	gap: 0.75rem;
}
</style>
