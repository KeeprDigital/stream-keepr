<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { FOLLOWS_THE_THEME, headerSummary, lookSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'pairings',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('pairings').fields;

// The Matches the Screen pages, read and followed as its Screen Output reads
// and follows them, so the page count is the one it renders (#780).
const { rowCount, loading: loadingMatches, answered: rowsAnswered } = useEditedScreenModeData(
	{
		screen: () => props.screen,
		eventId: () => props.eventId,
		saving: () => saving.value,
	},
	usePairingsModeData,
);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape.
const rotation = useRotationConfigWrites({
	mode: 'pairings',
	config,
	rowCount,
	saveConfig,
});
const { updateConfig } = rotation;

// ── Closed card summaries ──
const lookOf = (...groups: string[]) => lookSummary('pairings', props.screen.themeOverrides, groups);
const tableSummary = computed(() => settingsSummary([
	lookOf('table', 'result-badge'),
], FOLLOWS_THE_THEME));
const headerCardSummary = computed(() => settingsSummary([
	headerSummary(config.value),
	lookOf('header'),
]));
const paginationCardSummary = computed(() => paginationSummary(rotation));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="pairings:data" title="Data" :collapsible="false">
			<ScreenRoundField
				:model-value="config.roundId"
				null-label="Select a round…"
				description="Select the round whose pairings should be shown."
				:event-id="eventId"
				@update:model-value="updateConfig({ roundId: $event, currentPage: 1 })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="pairings:table" title="Table" :summary="tableSummary">
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="table" />

			<ScreenSettingsGroup title="Result Badge">
				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="result-badge" />
			</ScreenSettingsGroup>
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="pairings:header"
			:config="config"
			:fields="fields"
			:summary="headerCardSummary"
			show-description="Show the round name above the pairings."
			auto-description="Leave empty for the round's name and pairings."
			@update="updateConfig($event)"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenHeaderSettingsCard>

		<ScreenPaginationSettingsCard
			id="pairings:pagination"
			:rotation="rotation"
			:summary="paginationCardSummary"
			page-size-description="Number of pairings shown per page."
			auto-page-description="Automatically cycle through pairings pages."
			:loading="loadingMatches"
			:counting="!rowsAnswered"
		/>
	</div>
</template>
