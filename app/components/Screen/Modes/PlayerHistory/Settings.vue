<script setup lang="ts">
import type { PlayerHistoryColumnConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';
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

const estimatedRowCount = ref(0);
const loadingHistory = ref(false);
let requestId = 0;

const columnLabels: Record<PlayerHistoryColumnConfig['key'], string> = {
	round: 'Round',
	opponent: 'Opponent',
	table: 'Table',
	outcome: 'Outcome',
};

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape.
const {
	currentPage,
	totalPages,
	updateConfig,
	setAutoPageEnabled,
	adminNextPage,
	adminPrevPage,
} = useRotationConfigWrites({ mode: 'player-history', config, rowCount: estimatedRowCount, saveConfig });

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players']);

onMounted(async () => {
	if (props.eventId && !playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(props.eventId);
	}
});

watch(() => config.value.playerId, async (playerId) => {
	const id = ++requestId;
	estimatedRowCount.value = 0;

	if (!playerId) {
		return;
	}

	loadingHistory.value = true;
	try {
		const data = await $fetch<{ history: unknown[] }>(`/api/events/${props.eventId}/players/${playerId}/match-history`);
		if (id === requestId) {
			estimatedRowCount.value = data.history.length;
		}
	}
	finally {
		if (id === requestId) {
			loadingHistory.value = false;
		}
	}
}, { immediate: true });
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
				:columns="config.columns"
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
					@update:model-value="updateConfig({ headerText: $event || undefined })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Pagination">
			<UFormField
				:label="fields.rowsPerPage.label"
				description="Number of match rows shown per page."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.rowsPerPage"
					:min="fields.rowsPerPage.min"
					:max="fields.rowsPerPage.max"
					class="w-32"
					@update:model-value="updateConfig({ rowsPerPage: Number($event) })"
				/>
			</UFormField>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Automatic Paging
			</p>

			<ScreenSettingsToggle
				:label="fields.autoPageEnabled.label"
				description="Automatically cycle through match history pages."
				:model-value="config.autoPageEnabled"
				@update:model-value="setAutoPageEnabled($event === true)"
			/>

			<UFormField
				v-if="config.autoPageEnabled"
				:label="fields.autoPageIntervalMs.label"
				description="Time between page transitions."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="Math.round(config.autoPageIntervalMs / fields.autoPageIntervalMs.displayScale)"
					:min="fields.autoPageIntervalMs.min"
					:max="fields.autoPageIntervalMs.max"
					class="w-32"
					@update:model-value="updateConfig({ autoPageIntervalMs: Number($event) * fields.autoPageIntervalMs.displayScale })"
				/>
			</UFormField>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Manual Page Controls
			</p>

			<div class="flex items-center justify-center gap-2 max-sm:flex-wrap">
				<UButton
					icon="i-lucide-chevron-left"
					variant="outline"
					:disabled="totalPages <= 1 || loadingHistory"
					@click="adminPrevPage"
				>
					Previous
				</UButton>
				<span class="text-sm text-muted min-w-24 text-center">
					Page {{ currentPage }} of {{ totalPages }}
				</span>
				<UButton
					trailing-icon="i-lucide-chevron-right"
					variant="outline"
					:disabled="totalPages <= 1 || loadingHistory"
					@click="adminNextPage"
				>
					Next
				</UButton>
			</div>
		</ScreenSettingsCard>
	</div>
</template>
