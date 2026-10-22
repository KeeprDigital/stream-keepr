<script setup lang="ts">
import type { HeadToHeadPlayerSource } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const playerStore = usePlayerStore();
const featureMatchStore = useFeatureMatchStore();
const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'head-to-head',
);

defineExpose({ resetConfig, saving });

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('head-to-head').fields;

const sourceOptions: { label: string; value: HeadToHeadPlayerSource }[] = [
	{ label: 'A Feature Match Slot', value: 'featureMatchSlot' },
	{ label: 'Two Players', value: 'players' },
];

const slotOptions = useFeatureMatchMenuItems();

const playerOptions = computed(() => [
	{ label: 'Select a player…', value: null },
	...playerStore.players.map(player => ({ label: player.name, value: player.id })),
]);

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots', 'players']);

onMounted(async () => {
	if (!props.eventId)
		return;
	await Promise.all([
		featureMatchStore.loadFeatureMatchesByEventId(props.eventId),
		playerStore.isLoaded ? undefined : playerStore.loadPlayersByEventId(props.eventId),
	]);
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Players">
			<UFormField
				:label="fields.playerSource.label"
				description="Follow a Feature Match Slot as it is reassigned, or pick the two Players."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="head-to-head-source"
					:model-value="config.playerSource"
					:items="sourceOptions"
					class="w-64"
					@update:model-value="updateConfig({ playerSource: $event })"
				/>
			</UFormField>

			<UFormField
				v-if="config.playerSource === 'featureMatchSlot'"
				label="Feature Match Slot"
				description="Shows the two Players of the Match this Slot is showing."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="head-to-head-slot"
					:model-value="config.featureMatchId ?? undefined"
					:items="slotOptions"
					value-key="value"
					placeholder="Select a slot…"
					class="w-64"
					@update:model-value="updateConfig({ featureMatchId: $event ?? null })"
				/>
			</UFormField>

			<template v-else>
				<UFormField
					label="First Player"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						data-testid="head-to-head-player-1"
						:model-value="config.player1Id ?? null"
						:items="playerOptions"
						class="w-64"
						@update:model-value="updateConfig({ player1Id: $event ?? null })"
					/>
				</UFormField>
				<UFormField
					label="Second Player"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						data-testid="head-to-head-player-2"
						:model-value="config.player2Id ?? null"
						:items="playerOptions"
						class="w-64"
						@update:model-value="updateConfig({ player2Id: $event ?? null })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show a title above the two Players."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for &quot;Head to Head&quot;."
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
	</div>
</template>
