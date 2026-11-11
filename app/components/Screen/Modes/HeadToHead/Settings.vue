<script setup lang="ts">
import type { HeadToHeadPlayerSource } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { FOLLOWS_THE_THEME, headerSummary, lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const playerStore = usePlayerStore();
const featureMatchStore = useFeatureMatchStore();
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

const playerOptions = computed(() => [
	{ label: 'Select a player…', value: null },
	...playerStore.players.map(player => ({ label: player.name, value: player.id })),
]);

// ── Closed card summaries ──
const lookOf = (...groups: string[]) => lookSummary('head-to-head', props.screen.themeOverrides, groups);
const playerDetailsSummary = computed(() => settingsSummary([
	config.value.showPronouns && hasPronouns.value
		? 'Pronouns shown'
		: 'Pronouns hidden',
	config.value.showDeckColors ? 'Deck colors shown' : 'Deck colors hidden',
	lookOf('player-details'),
]));
const earlierMatchesSummary = computed(() => settingsSummary([
	lookOf('earlier-matches'),
], FOLLOWS_THE_THEME));
const headerCardSummary = computed(() => settingsSummary([
	headerSummary(config.value),
	lookOf('header'),
]));

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots', 'players']);

onMounted(async () => {
	if (!props.eventId)
		return;
	await Promise.all([
		featureMatchStore.loadFeatureMatchesByEventId(props.eventId),
		playerStore.isLoaded
			? undefined
			: playerStore.loadPlayersByEventId(props.eventId),
	]);
});
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

			<ScreenSettingsField
				v-if="config.playerSource === 'featureMatchSlot'"
				label="Feature Match Slot"
				description="Shows the two Players of the Match this Slot is showing."
			>
				<ScreenFeatureMatchSelect
					data-testid="head-to-head-slot"
					:model-value="config.featureMatchId"
					placeholder="Select a slot…"
					@update:model-value="updateConfig({ featureMatchId: $event })"
				/>
			</ScreenSettingsField>

			<template v-else>
				<ScreenSettingsField label="First Player">
					<USelect
						data-testid="head-to-head-player-1"
						:model-value="config.player1Id ?? null"
						:items="playerOptions"
						class="w-64"
						@update:model-value="updateConfig({ player1Id: $event ?? null })"
					/>
				</ScreenSettingsField>
				<ScreenSettingsField label="Second Player">
					<USelect
						data-testid="head-to-head-player-2"
						:model-value="config.player2Id ?? null"
						:items="playerOptions"
						class="w-64"
						@update:model-value="updateConfig({ player2Id: $event ?? null })"
					/>
				</ScreenSettingsField>
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

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="player-details" />
		</ScreenSettingsSection>

		<ScreenSettingsSection id="head-to-head:earlier-matches" title="Earlier Matches" :summary="earlierMatchesSummary">
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="earlier-matches" />
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="head-to-head:header"
			:config="config"
			:fields="fields"
			:summary="headerCardSummary"
			show-description="Show a title above the two Players."
			auto-description="Leave empty for &quot;Head to Head&quot;."
			@update="updateConfig($event)"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenHeaderSettingsCard>
	</div>
</template>
