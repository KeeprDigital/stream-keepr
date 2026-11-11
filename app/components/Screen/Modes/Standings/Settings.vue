<script setup lang="ts">
import type { RevealOrder, StandingsViewMode } from '~~/shared/types/enums';
import type { StandingsColumnConfig, StandingsModeConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { isColumnVisible, withEveryColumn } from '~~/shared/screenModeConfigs/subShapes';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { columnsSummary, headerSummary, lookSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
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
	'standings',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('standings').fields;

// ── Stores ──
// The Round picker loads its own Rounds and Phases; the watchlist's Player List picker reads this store.
const playerListStore = usePlayerListStore();

// What the Player List picker reads, re-read on Reconnect Resync (#610).
useConsumedEventData(['playerLists']);

onMounted(async () => {
	if (props.eventId && !playerListStore.isLoaded)
		await playerListStore.loadByEventId(props.eventId);
});

// ── View Mode Options ──
const viewModeOptions: { label: string; value: StandingsViewMode }[] = [
	{ label: 'All', value: 'all' },
	{ label: 'Position range', value: 'range' },
	{ label: 'Watchlist', value: 'watchlist' },
	{ label: 'Reveal', value: 'reveal' },
];

// ── Column Reordering ──
const COLUMN_LABELS: Record<StandingsColumnConfig['key'], string> = {
	position: '#',
	name: 'Name',
	record: 'Record (W-L-D)',
	points: 'Points',
	deck: 'Deck',
	positionChange: 'Position Change',
};

// A Screen whose columns were saved before a column existed is offered it too,
// as its defaults hold it (the Position Change column hidden), after its own.
const editorColumns = computed(() => withEveryColumn(config.value.columns, screenModeConfigContract('standings').defaults.columns));

const isDeckColumnVisible = computed(() => isColumnVisible(config.value.columns, 'deck'));

// ── Pagination ──
// The rows the Screen pages, its view mode and reveal applied, read and followed as its Screen Output reads and follows them, so
// the page count is the one it renders (#780).
const { rowCount, loading: loadingRows, answered: rowsAnswered, noPreviousRoundStandings } = useEditedScreenModeData(
	{
		screen: () => props.screen,
		eventId: () => props.eventId,
		saving: () => saving.value,
	},
	useStandingsModeData,
);

// The Screen's own read found no previous Round's Round Standings to compare
// with (#905); hiding the column clears the warning before the save lands.
const warnsPositionChangeHasNoData = computed(() =>
	isColumnVisible(config.value.columns, 'positionChange') && noPreviousRoundStandings.value);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape.
const rotation = useRotationConfigWrites({
	mode: 'standings',
	config,
	rowCount,
	saveConfig,
});
const { updateConfig } = rotation;

function updateRoundId(value: number | null | undefined) {
	updateConfig({ roundId: value ?? null, currentPage: 1 } as Partial<StandingsModeConfig>);
}

// ── Reveal Controls ──
const revealProgress = computed(() =>
	`${config.value.revealedCount} of ${config.value.revealCount} revealed`,
);

const isFullyRevealed = computed(() =>
	config.value.revealedCount >= config.value.revealCount,
);

function revealNext() {
	if (config.value.revealedCount < config.value.revealCount) {
		updateConfig({ revealedCount: config.value.revealedCount + 1 });
	}
}

function resetReveal() {
	updateConfig({ revealedCount: 0 });
}

// Auto-reset revealedCount when switching TO reveal mode
watch(() => config.value.viewMode, (newMode) => {
	if (newMode === 'reveal') {
		updateConfig({ revealedCount: 0, currentPage: 1 });
	}
});

// ── Reveal Order Options ──
const revealOrderOptions: { label: string; value: RevealOrder }[] = [
	{ label: 'Bottom up', value: 'bottomUp' },
	{ label: 'Top down', value: 'topDown' },
];

// ── Closed card summaries ──
const lookOf = (...groups: string[]) => lookSummary('standings', props.screen.themeOverrides, groups);
const tableSummary = computed(() => settingsSummary([
	columnsSummary(editorColumns.value),
	lookOf('table'),
]));
const headerCardSummary = computed(() => headerSummary(config.value));
const paginationCardSummary = computed(() => paginationSummary(rotation));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="standings:data" title="Data" :collapsible="false">
			<ScreenRoundField
				:model-value="config.roundId"
				null-label="Current standings"
				description="Show current standings or a saved completed-round snapshot."
				:event-id="eventId"
				@update:model-value="updateRoundId"
			/>

			<ScreenConfigField
				:field="fields.viewMode"
				:model-value="config.viewMode"
				:items="viewModeOptions"
				description="How standings are filtered and displayed."
				@update:model-value="updateConfig({ viewMode: $event as StandingsViewMode })"
			/>

			<template v-if="config.viewMode === 'range'">
				<ScreenConfigField
					:field="fields.rangeStart"
					:model-value="config.rangeStart"
					description="First position to include. 1 shows from the top."
					@update:model-value="updateConfig({ rangeStart: Number($event) })"
				/>
				<ScreenConfigField
					:field="fields.rangeEnd"
					:model-value="config.rangeEnd"
					description="Last position to include."
					@update:model-value="updateConfig({ rangeEnd: Number($event) })"
				/>
			</template>

			<ScreenPlayerListField
				v-else-if="config.viewMode === 'watchlist'"
				:model-value="config.playerListId"
				description="Show standings for players in this list."
				@update:model-value="updateConfig({ playerListId: $event })"
			/>

			<template v-else-if="config.viewMode === 'reveal'">
				<ScreenConfigField
					:field="fields.revealCount"
					:model-value="config.revealCount"
					description="Total number of players in the reveal."
					@update:model-value="updateConfig({ revealCount: Number($event) })"
				/>
				<ScreenConfigField
					:field="fields.revealOrder"
					:model-value="config.revealOrder"
					:items="revealOrderOptions"
					description="Direction players are revealed."
					@update:model-value="updateConfig({ revealOrder: $event as RevealOrder })"
				/>
				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="data" />
			</template>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			v-if="config.viewMode === 'reveal'"
			id="standings:reveal-controls"
			title="Reveal Controls"
			:collapsible="false"
		>
			<div class="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
				<div class="flex items-center gap-2 max-sm:flex-wrap">
					<UButton
						label="Reveal Next"
						icon="i-lucide-eye"
						size="sm"
						:disabled="isFullyRevealed"
						@click="revealNext"
					/>
					<UButton
						label="Reset"
						icon="i-lucide-rotate-ccw"
						variant="ghost"
						color="error"
						size="sm"
						:disabled="config.revealedCount === 0"
						@click="resetReveal"
					/>
				</div>
				<UBadge variant="subtle" :color="isFullyRevealed ? 'success' : 'neutral'">
					{{ revealProgress }}
				</UBadge>
			</div>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="standings:table"
			title="Table"
			subtitle="Drag to reorder, toggle to show/hide."
			:summary="tableSummary"
		>
			<ScreenColumnVisibilityList
				:columns="editorColumns"
				:labels="COLUMN_LABELS"
				@update="updateConfig({ columns: $event })"
			/>

			<ScreenConfigField
				v-if="isDeckColumnVisible"
				:field="fields.showArchetypeColors"
				:model-value="config.showArchetypeColors"
				description="Show mana colors inline after the archetype name in the deck column."
				@update:model-value="updateConfig({ showArchetypeColors: $event === true })"
			/>

			<UAlert
				v-if="warnsPositionChangeHasNoData"
				data-testid="position-change-no-data"
				color="warning"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Position Change has no data for this Event yet"
				description="No Round before this Screen's Round holds Round Standings to compare with, so every Position Change cell is blank until Melee Sync stores them."
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="table" />
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="standings:header"
			:config="config"
			:fields="fields"
			:summary="headerCardSummary"
			show-description="Show the standings header above the table."
			auto-description="Leave empty for auto-generated header based on view mode."
			@update="updateConfig($event)"
		/>

		<ScreenPaginationSettingsCard
			id="standings:pagination"
			:rotation="rotation"
			:summary="paginationCardSummary"
			page-size-description="Number of players shown per page."
			auto-page-description="Automatically cycle through pages on the display."
			:loading="loadingRows"
			:counting="!rowsAnswered"
		/>
	</div>
</template>
