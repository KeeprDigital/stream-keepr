<script setup lang="ts">
import type { HeadToHeadPlayerSource } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { headerSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const eventStore = useEventStore();
const hasPronouns = computed(() => eventStore.event?.pronounsEnabled ?? true);
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

// ── Closed card summaries ──
const playerDetailsSummary = computed(() => settingsSummary([
	config.value.showPronouns && hasPronouns.value
		? 'Pronouns shown'
		: 'Pronouns hidden',
	config.value.showDeckColors ? 'Deck colors shown' : 'Deck colors hidden',
]));
const headerCardSummary = computed(() => headerSummary(config.value));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="head-to-head:players" title="Players" :collapsible="false">
			<ScreenConfigField
				:field="fields.playerSource"
				:model-value="config.playerSource"
				:items="sourceOptions"
				description="Follow a Feature Match Slot as it is reassigned, or pick the two Players."
				@update:model-value="updateConfig({ playerSource: $event as HeadToHeadPlayerSource })"
			/>

			<ScreenFeatureMatchSlotField
				v-if="config.playerSource === 'featureMatchSlot'"
				data-testid="head-to-head-slot"
				:model-value="config.featureMatchId"
				:event-id="eventId"
				description="Shows the two Players of the Match this Slot is showing."
				@update:model-value="updateConfig({ featureMatchId: $event })"
			/>

			<template v-else>
				<ScreenPlayerField
					data-testid="head-to-head-player-1"
					label="First Player"
					:model-value="config.player1Id"
					:event-id="eventId"
					@update:model-value="updateConfig({ player1Id: $event })"
				/>
				<ScreenPlayerField
					data-testid="head-to-head-player-2"
					label="Second Player"
					:model-value="config.player2Id"
					:event-id="eventId"
					@update:model-value="updateConfig({ player2Id: $event })"
				/>
			</template>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="head-to-head:player-details" title="Player Details" :summary="playerDetailsSummary">
			<ScreenConfigField
				:field="fields.showPronouns"
				:model-value="config.showPronouns"
				description="Show each Player's pronouns below their name."
				disabled-description="Enable player pronouns in event settings to use this."
				:enabled="hasPronouns"
				@update:model-value="updateConfig({ showPronouns: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showDeckColors"
				:model-value="config.showDeckColors"
				description="Show the mana colors of each Player's deck beside its name."
				@update:model-value="updateConfig({ showDeckColors: $event === true })"
			/>
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="head-to-head:header"
			:config="config"
			:fields="fields"
			:summary="headerCardSummary"
			show-description="Show a title above the two Players."
			auto-description="Leave empty for &quot;Head to Head&quot;."
			@update="updateConfig($event)"
		/>
	</div>
</template>
