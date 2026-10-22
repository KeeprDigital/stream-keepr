<script setup lang="ts">
import type { PlayerHistoryColumnConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { withEveryColumn } from '~~/shared/screenModeConfigs/subShapes';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const playerStore = usePlayerStore();
const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'player-history',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('player-history').fields;

const playerOptions = computed(() => [
	{ label: 'Select a player…', value: null },
	...playerStore.players.map(player => ({ label: player.name, value: player.id })),
]);

// The Player's Matches the Screen pages, read and followed as its Screen Output reads and follows them, so
// the page count is the one it renders (#780).
const { rowCount, loading: loadingHistory } = useEditedScreenModeData(
	{ screen: () => props.screen, eventId: () => props.eventId, saving: () => saving.value },
	usePlayerHistoryModeData,
);

const columnLabels: Record<PlayerHistoryColumnConfig['key'], string> = {
	round: 'Round',
	opponent: 'Opponent',
	table: 'Table',
	outcome: 'Outcome',
	opponentArchetype: 'Opponent archetype',
	gameScore: 'Game score',
};

// A Screen that stored its columns before a column was added still offers it, hidden.
const columns = computed(() => withEveryColumn(config.value.columns, screenModeConfigContract('player-history').defaults.columns));

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape.
const rotation = useRotationConfigWrites({ mode: 'player-history', config, rowCount, saveConfig });
const { updateConfig } = rotation;

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players']);

onMounted(async () => {
	if (props.eventId && !playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(props.eventId);
	}
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				label="Player"
				description="Select the player whose match history should be shown."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.playerId"
					:items="playerOptions"
					class="w-64"
					@update:model-value="updateConfig({ playerId: $event, currentPage: 1 })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Columns" subtitle="Drag to reorder, toggle to show/hide.">
			<ScreenColumnVisibilityList
				:columns="columns"
				:labels="columnLabels"
				@update="updateConfig({ columns: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show the player name and record above the match history."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for the player's name and match history."
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
			page-size-description="Number of match rows shown per page."
			auto-page-description="Automatically cycle through match history pages."
			:loading="loadingHistory"
		/>
	</div>
</template>
