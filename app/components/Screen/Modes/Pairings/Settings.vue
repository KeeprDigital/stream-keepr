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
const rotation = useRotationConfigWrites({ mode: 'pairings', config, rowCount: estimatedRowCount, saveConfig });
const { updateConfig } = rotation;

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
	catch (error) {
		// The count only enables the manual page controls; without it they stay on one page.
		console.error('Failed to count the Round\'s Matches', error);
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

		<ScreenPaginationSettingsCard
			:rotation="rotation"
			page-size-description="Number of pairings shown per page."
			auto-page-description="Automatically cycle through pairings pages."
			:loading="loadingMatches"
		/>
	</div>
</template>
