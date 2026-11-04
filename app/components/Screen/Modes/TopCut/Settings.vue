<script setup lang="ts">
import type { Screen } from '~/types';
import { TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { FOLLOWS_THE_THEME, headerSummary, lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'top-cut',
);

defineExpose({ resetConfig, saving });

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('top-cut').fields;

const phaseStore = usePhaseStore();

// What the picker below loads, re-read on Reconnect Resync (#610).
useConsumedEventData(['phases']);

onMounted(async () => {
	if (props.eventId && !phaseStore.isLoaded)
		await phaseStore.loadPhasesByEventId(props.eventId);
});

// Nothing marks a Phase as a top cut, so every Phase of the Event is offered (#752).
const phaseOptions = computed(() => [
	{ label: 'Select a phase…', value: null },
	...[...phaseStore.phases]
		.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
		.map(phase => ({ label: phase.name, value: phase.id })),
]);

// Unset, the first Round sizes the bracket; a set size only enlarges it (#906).
const sizeOptions = [
	{ label: 'From the first Round', value: null },
	...TOP_CUT_BRACKET_SIZES.map(size => ({ label: `Top ${size}`, value: size })),
];

// ── Closed card summaries ──
const lookOf = (...groups: string[]) => lookSummary('top-cut', props.screen.themeOverrides, groups);
const entrantsSummary = computed(() => settingsSummary([
	config.value.showSeeds ? 'Seeds shown' : 'Seeds hidden',
	config.value.showArchetypes ? 'Archetypes shown' : 'Archetypes hidden',
	lookOf('entrants'),
]));
const bracketSummary = computed(() => settingsSummary([
	lookOf('bracket'),
], FOLLOWS_THE_THEME));
const championSummary = computed(() => settingsSummary([
	lookOf('champion'),
], FOLLOWS_THE_THEME));
const headerCardSummary = computed(() => settingsSummary([
	headerSummary(config.value),
	lookOf('header'),
]));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard id="top-cut:data" title="Data" :collapsible="false">
			<ScreenSettingsField
				label="Phase"
				name="phaseId"
				description="The bracket shows this Phase's Rounds in order, its first Round placed by each Player's Seed."
			>
				<USelect
					:model-value="config.phaseId ?? null"
					:items="phaseOptions"
					class="w-64"
					@update:model-value="updateConfig({ phaseId: $event ?? null })"
				/>
			</ScreenSettingsField>

			<ScreenSettingsField
				label="Bracket size"
				name="bracketSizeOverride"
				description="Set it to show the byes the best Seeds take before the next Round is paired; a size smaller than the first Round needs is ignored."
			>
				<USelect
					:model-value="config.bracketSizeOverride ?? null"
					:items="sizeOptions"
					class="w-64"
					@update:model-value="updateConfig({ bracketSizeOverride: $event ?? null })"
				/>
			</ScreenSettingsField>
		</ScreenSettingsCard>

		<ScreenSettingsCard id="top-cut:entrants" title="Entrants" :summary="entrantsSummary">
			<ScreenConfigField
				:field="fields.showSeeds"
				:model-value="config.showSeeds"
				description="Show each Player's final position in the last Round Standings before this Phase."
				@update:model-value="updateConfig({ showSeeds: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showArchetypes"
				:model-value="config.showArchetypes"
				description="Show each Player's archetype under their name, or their Deck List's deck name; blank when they have neither."
				@update:model-value="updateConfig({ showArchetypes: $event === true })"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="entrants" />
		</ScreenSettingsCard>

		<ScreenSettingsCard id="top-cut:bracket" title="Bracket" :summary="bracketSummary">
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="bracket" />
		</ScreenSettingsCard>

		<ScreenSettingsCard id="top-cut:champion" title="Champion" :summary="championSummary">
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="champion" />
		</ScreenSettingsCard>

		<ScreenHeaderSettingsCard
			id="top-cut:header"
			:config="config"
			:fields="fields"
			:summary="headerCardSummary"
			show-description="Show a title above the bracket."
			auto-description="Leave empty for the Phase's name."
			@update="updateConfig($event)"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenHeaderSettingsCard>
	</div>
</template>
