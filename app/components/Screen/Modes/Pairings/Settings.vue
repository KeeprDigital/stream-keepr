<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const roundStore = useRoundStore();
const matchRepository = useMatchRepository();
const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'pairings',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('pairings').fields;

const roundOptions = computed(() => [
	{ label: 'Select a round…', value: null },
	...roundStore.rounds.map(round => ({ label: round.name, value: round.id })),
]);

const estimatedRowCount = ref(0);
const loadingMatches = ref(false);
let requestId = 0;

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
} = useRotationConfigWrites({ mode: 'pairings', config, rowCount: estimatedRowCount, saveConfig });

// What the picker below loads, re-read on Reconnect Resync (#610).
useConsumedEventData(['rounds']);

onMounted(async () => {
	if (props.eventId && !roundStore.isLoaded) {
		await roundStore.loadRoundsByEventId(props.eventId);
	}
});

// How many Matches the Round holds, for the manual page controls. Read through
// the repository rather than the Match store, whose loaded Round belongs to the
// operator's Matches page.
watch(() => config.value.roundId, async (roundId) => {
	const id = ++requestId;
	estimatedRowCount.value = 0;

	if (!roundId) {
		return;
	}

	loadingMatches.value = true;
	try {
		const matches = await matchRepository.list(props.eventId, roundId);
		if (id === requestId) {
			estimatedRowCount.value = matches.length;
		}
	}
	finally {
		if (id === requestId) {
			loadingMatches.value = false;
		}
	}
}, { immediate: true });
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				label="Round"
				description="Select the round whose pairings should be shown."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.roundId ?? null"
					:items="roundOptions"
					class="w-64"
					@update:model-value="updateConfig({ roundId: $event ?? null, currentPage: 1 })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show the round name above the pairings."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for the round's name and pairings."
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
				description="Number of pairings shown per page."
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
				description="Automatically cycle through pairings pages."
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
					:disabled="totalPages <= 1 || loadingMatches"
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
					:disabled="totalPages <= 1 || loadingMatches"
					@click="adminNextPage"
				>
					Next
				</UButton>
			</div>
		</ScreenSettingsCard>
	</div>
</template>
