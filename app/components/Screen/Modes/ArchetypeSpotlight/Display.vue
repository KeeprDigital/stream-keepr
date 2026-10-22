<script setup lang="ts">
import type { ScreenConfig } from '~~/shared/types/screenConfig';

const { screen } = useScreenContext();
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

const screenConfig = computed<Partial<ScreenConfig>>(() => (screen.value?.screenConfig ?? {}) as Partial<ScreenConfig>);
const primaryTextStyle = computed(() => screenConfig.value.primaryTextColor ? { color: screenConfig.value.primaryTextColor } : {});
const secondaryTextStyle = computed(() => screenConfig.value.secondaryTextColor ? { color: screenConfig.value.secondaryTextColor } : {});
const themeStyle = computed(() => ({
	'--broadcast-table-primary-text': screenConfig.value.primaryTextColor ?? '#ffffff',
	'--broadcast-table-secondary-text': screenConfig.value.secondaryTextColor ?? 'rgba(255, 255, 255, 0.72)',
}));

// The archetype page's stat strip, for the numbers a spotlight shows.
const stats = computed(() => {
	const data = spotlight.value;
	if (!data)
		return [];
	return [
		{ label: 'Pilots', value: String(data.playerCount) },
		{ label: 'Meta Share', value: `${data.metaShare}%` },
		{
			label: `Conversion (${conversionLabel.value})`,
			value: data.conversionRate != null && data.convertedCount != null
				? `${data.conversionRate}% (${data.convertedCount}/${data.playerCount})`
				: '-',
		},
	];
});

// Top Cards' default stat badge, so a card's inclusion rate reads the same on
// both Screens. Cards carry no rank badge here: their order is the ranking.
const statBadgeStyle = { color: '#111827', backgroundColor: '#ffffff' };
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="isEmpty"
	>
		<div class="archetype-spotlight-display broadcast-table-display flex flex-col gap-4 h-full w-full" :style="themeStyle">
			<div v-if="config.showHeader" class="spotlight-header broadcast-table-title">
				<h2 :style="primaryTextStyle">
					{{ headerText }}
				</h2>
			</div>

			<div v-if="spotlight" class="spotlight-summary flex items-center justify-between gap-6 px-4">
				<div class="flex items-center gap-3 min-w-0">
					<span class="spotlight-name truncate" :style="primaryTextStyle">{{ spotlight.archetype.name }}</span>
					<MtgManaColorDisplay
						v-if="spotlight.archetype.colors"
						:colors="spotlight.archetype.colors"
						size="lg"
						:cost="true"
					/>
				</div>
				<div class="flex gap-8">
					<div v-for="stat in stats" :key="stat.label" class="spotlight-stat flex flex-col items-end">
						<span class="stat-label broadcast-table-secondary" :style="secondaryTextStyle">{{ stat.label }}</span>
						<span class="stat-value broadcast-table-numeric" :style="primaryTextStyle">{{ stat.value }}</span>
					</div>
				</div>
			</div>

			<div class="spotlight-body flex gap-6 flex-1 min-h-0 px-4">
				<div class="spotlight-pilots broadcast-table-surface">
					<div class="pilot-grid broadcast-table-header-row">
						<span>#</span>
						<span>Pilot</span>
						<span class="text-right">Record</span>
					</div>
					<div
						v-for="pilot in pageData"
						:key="pilot.id"
						class="pilot-row pilot-grid broadcast-table-row"
					>
						<span class="pilot-position broadcast-table-numeric broadcast-table-secondary" :style="secondaryTextStyle">{{ pilot.position ?? '-' }}</span>
						<span class="pilot-name truncate" :style="primaryTextStyle">{{ pilot.name }}</span>
						<span class="pilot-record broadcast-table-numeric text-right" :style="primaryTextStyle">{{ formatRecord(pilot) }}</span>
					</div>
					<div
						v-if="totalPages > 1"
						class="broadcast-table-page-indicator"
						:style="secondaryTextStyle"
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
	font-size: clamp(1.5rem, 3vw, 2.75rem);
	font-weight: 800;
	line-height: 1;
}
.stat-label {
	font-family: var(--font-body);
	font-size: 0.8rem;
	font-weight: 800;
	letter-spacing: 0.1em;
	text-transform: uppercase;
}
.stat-value {
	font-size: clamp(1.25rem, 2.4vw, 2.25rem);
	font-weight: 800;
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
	font-size: clamp(1rem, 1.8vw, 1.6rem);
}
.pilot-name {
	font-weight: 600;
}
.spotlight-cards {
	flex: 1 1 55%;
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	align-content: start;
	gap: 0.75rem;
}
</style>
