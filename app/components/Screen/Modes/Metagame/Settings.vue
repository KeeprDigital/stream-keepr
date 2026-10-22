<script setup lang="ts">
import type {
	MetagameArchetypeColumnKey,
	MetagameCardColumnKey,
	MetagameCardSortBy,
	MetagameConversionMetric,
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
import { useConsumedEventData } from '~/modules/event-data/resync';
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

const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players', 'playerLists']);

onMounted(async () => {
	if (!props.eventId) {
		return;
	}

	if (!playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(props.eventId);
	}

	if (!playerListStore.isLoaded) {
		await playerListStore.loadByEventId(props.eventId);
	}
});

const viewModeOptions = [
	{ label: 'Archetypes', value: 'archetype' },
	{ label: 'Cards', value: 'cards' },
];

const conversionMetricOptions = [
	{ label: 'Top N', value: 'topN' },
	{ label: 'Minimum Points', value: 'minPoints' },
];

const sortByOptions = [
	{ label: 'Meta Share', value: 'metaShare' },
	{ label: 'Count', value: 'count' },
	{ label: 'Win Rate', value: 'winRate' },
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

const showsConversionRate = computed(() =>
	config.value.archetypeColumns.some(column => column.key === 'conversionRate' && column.visible),
);

const estimatedRowCount = computed(() => {
	if (config.value.viewMode === 'cards') {
		return config.value.limit;
	}

	let scopedPlayerCount: number;
	if (config.value.scope === 'topN') {
		scopedPlayerCount = config.value.topN;
	}
	else if (config.value.scope === 'minPoints') {
		scopedPlayerCount = playerStore.players
			.filter(player => player.points != null && player.points >= config.value.minPoints)
			.length;
	}
	else if (config.value.scope === 'playerList') {
		const list = playerListStore.lists.find(item => item.id === config.value.playerListId);
		scopedPlayerCount = list?.memberCount ?? 0;
	}
	else {
		scopedPlayerCount = playerStore.players.length;
	}

	return config.value.archetypeLimit == null
		? scopedPlayerCount
		: Math.min(scopedPlayerCount, config.value.archetypeLimit + 1);
});

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape.
const rotation = useRotationConfigWrites({ mode: 'metagame', config, rowCount: estimatedRowCount, saveConfig });
const { updateConfig } = rotation;

function persistColumns(columns: ActiveMetagameColumnConfig[]) {
	if (config.value.viewMode === 'cards') {
		updateConfig({ cardColumns: columns as MetagameCardColumnConfig[] });
		return;
	}

	updateConfig({ archetypeColumns: columns as MetagameArchetypeColumnConfig[] });
}

function updateMaxTableWidth(value: number | null | undefined) {
	updateConfig({ maxTableWidth: value ?? null });
}

function updateArchetypeLimit(value: number | null | undefined) {
	updateConfig({ archetypeLimit: value == null ? null : Number(value), currentPage: 1 });
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				:label="fields.viewMode.label"
				description="Choose the metagame table to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.viewMode"
					:items="viewModeOptions"
					class="w-48"
					@update:model-value="updateConfig({ viewMode: $event as MetagameViewMode, currentPage: 1 })"
				/>
			</UFormField>

			<ScreenMetagameScopeFields
				:config="config"
				:fields="fields"
				description="Which players to include in the breakdown."
				:show-archetype-filter="config.viewMode === 'cards'"
				@update="updateConfig({ ...$event, currentPage: 1 })"
			/>

			<template v-if="config.viewMode === 'archetype'">
				<UFormField
					:label="fields.sortBy.label"
					description="Order archetypes using this metric."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.sortBy"
						:items="sortByOptions"
						class="w-48"
						@update:model-value="updateConfig({ sortBy: $event as MetagameSortBy, currentPage: 1 })"
					/>
				</UFormField>

				<template v-if="showsConversionRate">
					<UFormField
						:label="fields.conversionMetric.label"
						description="What a player in the scope must reach to count as converted. It never narrows the scope."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<USelect
							:model-value="config.conversionMetric"
							:items="conversionMetricOptions"
							class="w-48"
							@update:model-value="updateConfig({ conversionMetric: $event as MetagameConversionMetric })"
						/>
					</UFormField>

					<UFormField
						:label="fields.conversionThreshold.label"
						:description="config.conversionMetric === 'topN' ? 'Converted at this placement or better.' : 'Converted at this many match points or more.'"
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="config.conversionThreshold"
							:min="fields.conversionThreshold.min"
							:max="fields.conversionThreshold.max"
							class="w-32"
							@update:model-value="updateConfig({ conversionThreshold: Number($event) })"
						/>
					</UFormField>
				</template>

				<UFormField
					:label="fields.archetypeLimit.label"
					description="Show the top archetypes and group the remainder as Other. Leave empty to show all."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.archetypeLimit"
						placeholder="All"
						:min="fields.archetypeLimit.min"
						:max="fields.archetypeLimit.max"
						class="w-32"
						@update:model-value="updateArchetypeLimit($event)"
					/>
				</UFormField>
			</template>

			<template v-else>
				<UFormField
					:label="fields.cardSortBy.label"
					description="Order cards using this metric."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.cardSortBy"
						:items="cardSortByOptions"
						class="w-48"
						@update:model-value="updateConfig({ cardSortBy: $event as MetagameCardSortBy, currentPage: 1 })"
					/>
				</UFormField>

				<UFormField
					:label="fields.limit.label"
					description="Maximum number of card rows to include."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.limit"
						:min="fields.limit.min"
						:max="fields.limit.max"
						class="w-32"
						@update:model-value="updateConfig({ limit: Number($event), currentPage: 1 })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Columns" subtitle="Drag to reorder, toggle to show/hide.">
			<ScreenColumnVisibilityList
				:columns="activeColumns"
				:labels="columnLabels"
				@update="persistColumns"
			/>

			<USeparator />

			<UFormField
				:label="fields.maxTableWidth.label"
				description="Optional cap in pixels. Leave empty to fill the available width."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.maxTableWidth ?? null"
					placeholder="Auto"
					:min="fields.maxTableWidth.min"
					class="w-32"
					@update:model-value="updateMaxTableWidth($event)"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show the metagame title above the table."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for an auto-generated title."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInput
					:model-value="config.headerText ?? ''"
					placeholder="Auto"
					class="w-64"
					@update:model-value="updateConfig({ headerText: $event || null })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenPaginationSettingsCard
			:rotation="rotation"
			page-size-description="Number of table rows shown per page."
			auto-page-description="Automatically cycle through table pages."
		/>

		<ScreenSettingsCard title="Animation">
			<ScreenSettingsToggle
				:label="fields.animateEntries.label"
				description="Animate row changes when the table updates."
				:model-value="config.animateEntries"
				@update:model-value="updateConfig({ animateEntries: $event })"
			/>
		</ScreenSettingsCard>
	</div>
</template>
