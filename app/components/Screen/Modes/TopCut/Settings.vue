<script setup lang="ts">
import type { ManualBracket } from '~~/shared/modules/top-cut-bracket';
import type { TopCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
import type { PlayerNameShown } from '~~/shared/utils/playerName';
import type { Screen } from '~/types';
import { TOP_CUT_BRACKET_SIZES, topCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
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

const playerStore = usePlayerStore();
const eventStore = useEventStore();

// A One Piece Card Game Event holds no Phases, so it offers only the Manual Bracket (ADR-0075).
const game = computed(() => eventStore.event?.game);
const offersPhases = computed(() => game.value !== 'op');
const source = computed(() => topCutBracketSource(game.value, config.value));

// Only a One Piece Card Game Player has a Nickname to show instead (ADR-0077).
const playerNameShownOptions: { label: string; value: PlayerNameShown }[] = [
	{ label: 'Name', value: 'name' },
	{ label: 'Nickname', value: 'nickname' },
];

const sourceOptions: { label: string; value: TopCutBracketSource }[] = [
	{ label: 'A Phase', value: 'phase' },
	{ label: 'Entered by hand', value: 'manual' },
];

// The Players a Manual Bracket's Seeds pick from, re-read on Reconnect Resync (#610).
useConsumedEventData(['players']);

onMounted(async () => {
	if (props.eventId && !playerStore.isLoaded)
		await playerStore.loadPlayersByEventId(props.eventId);
});

function updateManualBracket(manualBracket: ManualBracket) {
	updateConfig({ manualBracket });
}

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
	game.value === 'op'
		? config.value.playerNameShown === 'nickname'
			? 'By Nickname'
			: 'By name'
		: null,
]));
const bracketSummary = computed(() => settingsSummary([
	lookOf('bracket'),
], FOLLOWS_THE_THEME));
const championSummary = computed(() => settingsSummary([
	lookOf('champion'),
], FOLLOWS_THE_THEME));
const headerCardSummary = computed(() => headerSummary(config.value));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="top-cut:data" title="Data" :collapsible="false">
			<ScreenConfigField
				v-if="offersPhases"
				:field="fields.bracketSource"
				:model-value="config.bracketSource"
				:items="sourceOptions"
				description="Derive the bracket from a Phase's Rounds and Match Results, or enter its entrants and results by hand."
				@update:model-value="updateConfig({ bracketSource: $event as TopCutBracketSource })"
			/>

			<ScreenModesTopCutManualBracketEditor
				v-if="source === 'manual'"
				:manual="config.manualBracket"
				@update="updateManualBracket"
			/>

			<template v-else>
				<ScreenPhaseField
					name="phaseId"
					:model-value="config.phaseId"
					:event-id="eventId"
					description="The bracket shows this Phase's Rounds in order, its first Round placed by each Player's Seed."
					@update:model-value="updateConfig({ phaseId: $event })"
				/>

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
			</template>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="top-cut:entrants" title="Entrants" :summary="entrantsSummary">
			<ScreenConfigField
				v-if="game === 'op'"
				:field="fields.playerNameShown"
				:model-value="config.playerNameShown"
				:items="playerNameShownOptions"
				description="Show each Player by their name or their Nickname; a Player without the one chosen shows the other."
				@update:model-value="updateConfig({ playerNameShown: $event as PlayerNameShown })"
			/>
			<ScreenConfigField
				:field="fields.showSeeds"
				:model-value="config.showSeeds"
				:description="source === 'manual'
					? 'Show each entrant\'s Seed, their place in the list above.'
					: 'Show each Player\'s final position in the last Round Standings before this Phase.'"
				@update:model-value="updateConfig({ showSeeds: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showArchetypes"
				:model-value="config.showArchetypes"
				description="Show each Player's archetype under their name, or their Deck List's deck name; blank when they have neither."
				@update:model-value="updateConfig({ showArchetypes: $event === true })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="top-cut:bracket" title="Bracket" :summary="bracketSummary">
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="bracket" />
		</ScreenSettingsSection>

		<ScreenSettingsSection id="top-cut:champion" title="Champion" :summary="championSummary">
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="champion" />
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="top-cut:header"
			:config="config"
			:fields="fields"
			:summary="headerCardSummary"
			show-description="Show a title above the bracket."
			auto-description="Leave empty for the Phase's name."
			@update="updateConfig($event)"
		/>
	</div>
</template>
