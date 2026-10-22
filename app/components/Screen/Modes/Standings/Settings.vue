<script setup lang="ts">
import type { RevealOrder, StandingsViewMode } from '~~/shared/types/enums';
import type { StandingsColumnConfig, StandingsModeConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { isColumnVisible, withEveryColumn } from '~~/shared/screenModeConfigs/subShapes';
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
	'standings',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('standings').fields;

// ── Stores ──
const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();
const roundStore = useRoundStore();

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players', 'playerLists', 'rounds']);

onMounted(async () => {
	if (props.eventId) {
		if (!playerStore.isLoaded) {
			await playerStore.loadPlayersByEventId(props.eventId);
		}
		if (!playerListStore.isLoaded) {
			await playerListStore.loadByEventId(props.eventId);
		}
		if (!roundStore.isLoaded) {
			await roundStore.loadRoundsByEventId(props.eventId);
		}
	}
});

// ── View Mode Options ──
const viewModeOptions = [
	{ label: 'All', value: 'all' },
	{ label: 'Top N', value: 'topN' },
	{ label: 'Slice', value: 'slice' },
	{ label: 'Watchlist', value: 'watchlist' },
	{ label: 'Reveal', value: 'reveal' },
];

// ── Player List Options (for watchlist) ──
const playerListOptions = computed(() => [
	{ label: 'Select a list...', value: null },
	...playerListStore.lists.map(l => ({
		label: `${l.name} (${l.memberCount})`,
		value: l.id,
	})),
]);

const roundOptions = computed(() => [
	{ label: 'Current', value: null },
	...roundStore.rounds.map(round => ({
		label: round.name,
		value: round.id,
	})),
]);

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
// Estimate display row count from player store for page controls
const estimatedRowCount = computed(() => {
	const mode = config.value.viewMode;
	const total = playerStore.players.length;

	if (mode === 'topN')
		return Math.min(config.value.topNCount, total);
	if (mode === 'slice') {
		return playerStore.players.filter(p =>
			p.position != null
			&& p.position >= config.value.sliceStart
			&& p.position <= config.value.sliceEnd,
		).length;
	}
	if (mode === 'watchlist') {
		const list = playerListStore.lists.find(l => l.id === config.value.playerListId);
		return list?.memberCount ?? 0;
	}
	if (mode === 'reveal')
		return config.value.revealCount;
	return total;
});

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
} = useRotationConfigWrites({ mode: 'standings', config, rowCount: estimatedRowCount, saveConfig });

function updateMaxTableWidth(value: number | null | undefined) {
	updateConfig({ maxTableWidth: value ?? null } as Partial<StandingsModeConfig>);
}

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
const revealOrderOptions = [
	{ label: 'Bottom up', value: 'bottomUp' },
	{ label: 'Top down', value: 'topDown' },
];

const modeSettingsLabel = computed(() => {
	switch (config.value.viewMode) {
		case 'topN':
			return 'Top N Settings';
		case 'slice':
			return 'Range Settings';
		case 'watchlist':
			return 'Player List';
		case 'reveal':
			return 'Reveal Settings';
		default:
			return '';
	}
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="View Mode">
			<UFormField
				label="Round"
				description="Show current standings or a saved completed-round snapshot."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.roundId ?? null"
					:items="roundOptions"
					class="w-64"
					@update:model-value="updateRoundId($event)"
				/>
			</UFormField>

			<USeparator />

			<UFormField
				:label="fields.viewMode.label"
				description="How standings are filtered and displayed."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.viewMode"
					:items="viewModeOptions"
					class="w-48"
					@update:model-value="updateConfig({ viewMode: $event as StandingsViewMode })"
				/>
			</UFormField>

			<template v-if="config.viewMode !== 'all'">
				<USeparator />

				<p class="text-xs font-semibold uppercase tracking-wider text-muted">
					{{ modeSettingsLabel }}
				</p>

				<UFormField
					v-if="config.viewMode === 'topN'"
					:label="fields.topNCount.label"
					description="Show the top N players by position."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.topNCount"
						:min="fields.topNCount.min"
						:max="fields.topNCount.max"
						class="w-32"
						@update:model-value="updateConfig({ topNCount: Number($event) })"
					/>
				</UFormField>

				<template v-else-if="config.viewMode === 'slice'">
					<UFormField
						:label="fields.sliceStart.label"
						description="First position to include."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="config.sliceStart"
							:min="fields.sliceStart.min"
							:max="fields.sliceStart.max"
							class="w-32"
							@update:model-value="updateConfig({ sliceStart: Number($event) })"
						/>
					</UFormField>

					<UFormField
						:label="fields.sliceEnd.label"
						description="Last position to include."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="config.sliceEnd"
							:min="fields.sliceEnd.min"
							:max="fields.sliceEnd.max"
							class="w-32"
							@update:model-value="updateConfig({ sliceEnd: Number($event) })"
						/>
					</UFormField>
				</template>

				<template v-else-if="config.viewMode === 'watchlist'">
					<template v-if="playerListStore.lists.length > 0">
						<UFormField
							label="Select list"
							description="Show standings for players in this list."
							class="flex max-sm:flex-col justify-between items-start gap-4"
						>
							<USelect
								:model-value="config.playerListId ?? null"
								:items="playerListOptions"
								class="w-64"
								@update:model-value="updateConfig({ playerListId: $event ?? null })"
							/>
						</UFormField>
					</template>
					<div v-else class="text-sm text-muted text-center py-2">
						No player lists available. Create one on the Players page.
					</div>
				</template>

				<template v-else-if="config.viewMode === 'reveal'">
					<UFormField
						:label="fields.revealCount.label"
						description="Total number of players in the reveal."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="config.revealCount"
							:min="fields.revealCount.min"
							:max="fields.revealCount.max"
							class="w-32"
							@update:model-value="updateConfig({ revealCount: Number($event) })"
						/>
					</UFormField>

					<UFormField
						:label="fields.revealOrder.label"
						description="Direction players are revealed."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<USelect
							:model-value="config.revealOrder"
							:items="revealOrderOptions"
							class="w-40"
							@update:model-value="updateConfig({ revealOrder: $event as RevealOrder })"
						/>
					</UFormField>
				</template>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard v-if="config.viewMode === 'reveal'" title="Reveal Controls">
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
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Columns" subtitle="Drag to reorder, toggle to show/hide.">
			<ScreenColumnVisibilityList
				:columns="editorColumns"
				:labels="COLUMN_LABELS"
				@update="updateConfig({ columns: $event })"
			/>

			<template v-if="isDeckColumnVisible">
				<USeparator />

				<ScreenSettingsToggle
					:label="fields.showArchetypeColors.label"
					description="Show mana colors inline after the archetype name in the deck column."
					:model-value="config.showArchetypeColors"
					@update:model-value="updateConfig({ showArchetypeColors: $event })"
				/>
			</template>

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
				description="Show the standings header above the table."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for auto-generated header based on view mode."
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

		<ScreenSettingsCard title="Pagination">
			<UFormField
				:label="fields.rowsPerPage.label"
				description="Number of players shown per page."
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
				description="Automatically cycle through pages on the display."
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
					size="sm"
					:disabled="totalPages <= 1"
					@click="adminPrevPage"
				/>
				<span class="text-sm text-muted px-2">
					Page {{ currentPage }} of {{ totalPages }}
				</span>
				<UButton
					icon="i-lucide-chevron-right"
					variant="outline"
					size="sm"
					:disabled="totalPages <= 1"
					@click="adminNextPage"
				/>
			</div>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Animation">
			<ScreenSettingsToggle
				:label="fields.animateEntries.label"
				description="Animate row transitions on the display."
				:model-value="config.animateEntries"
				@update:model-value="updateConfig({ animateEntries: $event })"
			/>
		</ScreenSettingsCard>
	</div>
</template>
