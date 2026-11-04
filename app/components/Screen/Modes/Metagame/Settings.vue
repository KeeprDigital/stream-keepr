<script setup lang="ts">
import type {
	MetagameArchetypeColumnKey,
	MetagameCardColumnKey,
	MetagameCardSortBy,
	MetagameSortBy,
	MetagameViewMode,
} from '~~/shared/types/enums';
import type {
	MetagameArchetypeColumnConfig,
	MetagameCardColumnConfig,
} from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { withEveryColumn } from '~~/shared/screenModeConfigs/subShapes';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { METAGAME_CHART_MAX_ARCHETYPES } from '~~/shared/utils/metagameChart';
import { headerSummary, lookSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'metagame',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('metagame').fields;

const playerListStore = usePlayerListStore();

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['playerLists']);

onMounted(async () => {
	if (!props.eventId) {
		return;
	}

	if (!playerListStore.isLoaded) {
		await playerListStore.loadByEventId(props.eventId);
	}
});

const viewModeOptions = [
	{ label: 'Archetypes', value: 'archetype' },
	{ label: 'Cards', value: 'cards' },
	{ label: 'Chart', value: 'chart' },
];

const sortByOptions = [
	{ label: 'Meta Share', value: 'metaShare' },
	{ label: 'Count', value: 'count' },
	{ label: 'Win Rate', value: 'winRate' },
	{ label: 'Conversion Rate', value: 'conversionRate' },
];

const cardSortByOptions = [
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
];

type ActiveMetagameColumnConfig = MetagameArchetypeColumnConfig | MetagameCardColumnConfig;

const columnLabels: Record<MetagameArchetypeColumnKey | MetagameCardColumnKey, string> = {
	archetype: 'Archetype',
	count: 'Count',
	metaShare: 'Share',
	winRate: 'Win Rate',
	avgPlace: 'Avg Place',
	colors: 'Colors',
	conversionRate: 'Conversion Rate',
	card: 'Card',
	manaCost: 'Cost',
	type: 'Type',
	inclusionRate: 'Inclusion',
	avgCopies: 'Avg Copies',
	totalCopies: 'Total Copies',
	deckCount: 'Decks',
	mainboardCount: 'Main',
	sideboardCount: 'Side',
};

const { defaults } = screenModeConfigContract('metagame');

const activeColumns = computed<ActiveMetagameColumnConfig[]>(() =>
	config.value.viewMode === 'cards'
		? withEveryColumn(config.value.cardColumns, defaults.cardColumns)
		: withEveryColumn(config.value.archetypeColumns, defaults.archetypeColumns),
);

// The Event's Conversion Target matters while the Conversion Rate shows or orders the archetypes.
const showsConversionRate = computed(() =>
	config.value.sortBy === 'conversionRate'
	|| config.value.archetypeColumns.some(column => column.key === 'conversionRate' && column.visible),
);

// The table rows the Screen pages (none for a chart, which is one page), read and followed as its Screen Output reads and follows them, so
// the page count is the one it renders (#780).
const { rowCount, loading: loadingRows, answered: rowsAnswered } = useEditedScreenModeData(
	{
		screen: () => props.screen,
		eventId: () => props.eventId,
		saving: () => saving.value,
	},
	useMetagameModeData,
);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape.
const rotation = useRotationConfigWrites({
	mode: 'metagame',
	config,
	rowCount,
	saveConfig,
});
const { updateConfig } = rotation;

function persistColumns(columns: ActiveMetagameColumnConfig[]) {
	if (config.value.viewMode === 'cards') {
		updateConfig({ cardColumns: columns as MetagameCardColumnConfig[] });
		return;
	}

	updateConfig({ archetypeColumns: columns as MetagameArchetypeColumnConfig[] });
}

function updateArchetypeLimit(value: string | number | boolean | null) {
	updateConfig({
		archetypeLimit: value === null
			? null
			: Number(value),
		currentPage: 1,
	});
}

/** A closed card's one line: what it is set to, and how many Look overrides it holds. */
function look(group: string) {
	return lookSummary('metagame', props.screen.themeOverrides, [group]);
}

const tableSummary = computed(() => {
	const shown = activeColumns.value.filter(column => column.visible).length;
	return settingsSummary([
		`${shown} ${shown === 1
			? 'column'
			: 'columns'} shown`,
		look('table'),
	]);
});
const chartSummary = computed(() => settingsSummary([
	look('chart'),
], 'Follows the Theme'));
const sizeAndSurfaceSummary = computed(() => settingsSummary([
	look('size-and-surface'),
], 'Follows the Theme'));
const headerCardSummary = computed(() => settingsSummary([
	headerSummary(config.value),
	look('header'),
]));
const paginationCardSummary = computed(() => paginationSummary({ ...config.value, pageSize: rotation.pageSize.value }));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard id="metagame:data" title="Data" :collapsible="false">
			<ScreenConfigField
				:field="fields.viewMode"
				:model-value="config.viewMode"
				:items="viewModeOptions"
				description="Choose the metagame table or chart to show."
				@update:model-value="$event !== null && updateConfig({ viewMode: $event as MetagameViewMode, currentPage: 1 })"
			/>

			<ScreenMetagameScopeFields
				:config="config"
				:fields="fields"
				description="Which players to include in the breakdown."
				:show-archetype-filter="config.viewMode === 'cards'"
				@update="updateConfig({ ...$event, currentPage: 1 })"
			/>

			<template v-if="config.viewMode !== 'cards'">
				<ScreenConfigField
					:field="fields.sortBy"
					:model-value="config.sortBy"
					:items="sortByOptions"
					description="Order archetypes using this metric."
					@update:model-value="$event !== null && updateConfig({ sortBy: $event as MetagameSortBy, currentPage: 1 })"
				/>

				<ScreenConversionTargetField v-if="showsConversionRate" :event-id="eventId" />

				<ScreenConfigField
					:field="fields.archetypeLimit"
					:model-value="config.archetypeLimit"
					:description="config.viewMode === 'chart'
						? `Show the top archetypes and group the rest as Other; the chart draws at most ${METAGAME_CHART_MAX_ARCHETYPES}.`
						: 'Show the top archetypes and group the rest as Other, or leave empty to show all.'"
					placeholder="All"
					nullable
					@update:model-value="updateArchetypeLimit($event)"
				/>
			</template>

			<template v-else>
				<ScreenConfigField
					:field="fields.cardSortBy"
					:model-value="config.cardSortBy"
					:items="cardSortByOptions"
					description="Order cards using this metric."
					@update:model-value="$event !== null && updateConfig({ cardSortBy: $event as MetagameCardSortBy, currentPage: 1 })"
				/>

				<ScreenConfigField
					:field="fields.limit"
					:model-value="config.limit"
					description="Maximum number of card rows to include."
					@update:model-value="$event !== null && updateConfig({ limit: Number($event), currentPage: 1 })"
				/>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard
			v-if="config.viewMode !== 'chart'"
			id="metagame:table"
			title="Table"
			subtitle="Drag to reorder, toggle to show/hide."
			:summary="tableSummary"
		>
			<ScreenColumnVisibilityList
				:columns="activeColumns"
				:labels="columnLabels"
				@update="persistColumns"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="table" />
		</ScreenSettingsCard>

		<ScreenSettingsCard
			v-else
			id="metagame:chart"
			title="Chart"
			:summary="chartSummary"
		>
			<ScreenSettingsField
				label="Pinned Chart Series"
				description="Give an Archetype its own chart series on the Metagame page, so it keeps its colour."
			>
				<NuxtLink
					:to="`/event/${eventId}/metagame`"
					data-testid="pinned-chart-series-link"
					class="text-sm text-primary hover:underline"
				>
					Pin on the Metagame page
				</NuxtLink>
			</ScreenSettingsField>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="chart" />
		</ScreenSettingsCard>

		<ScreenSettingsCard
			id="metagame:size-and-surface"
			title="Size & Surface"
			subtitle="How wide the table or chart runs, and what it sits on."
			:summary="sizeAndSurfaceSummary"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="size-and-surface" />
		</ScreenSettingsCard>

		<ScreenHeaderSettingsCard
			id="metagame:header"
			:summary="headerCardSummary"
			:config="config"
			:fields="fields"
			show-description="Show the metagame title above the table."
			auto-description="Leave empty for an auto-generated title."
			@update="updateConfig($event)"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenHeaderSettingsCard>

		<ScreenPaginationSettingsCard
			v-if="config.viewMode !== 'chart'"
			id="metagame:pagination"
			:summary="paginationCardSummary"
			:rotation="rotation"
			page-size-description="Number of table rows shown per page."
			auto-page-description="Automatically cycle through table pages."
			:loading="loadingRows"
			:counting="!rowsAnswered"
		/>
	</div>
</template>
