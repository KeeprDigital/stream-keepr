<script setup lang="ts">
import type { BoardSelection } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { getFeatureMatchStateTracking, getMetagameRules } from '~~/shared/config/games';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { headerSummary, lookSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'archetype-spotlight',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('archetype-spotlight').fields;

const archetypeStore = useArchetypeStore();
const playerListStore = usePlayerListStore();
const eventStore = useEventStore();
// The Event's Card Game decides whether its Metagame reads standings, and its decks a Sideboard (ADR-0074).
const game = computed(() => eventStore.event?.game);
const readsStandings = computed(() => !game.value || getMetagameRules(game.value).readsStandings);
const hasSideboard = computed(() => !game.value || getFeatureMatchStateTracking(game.value).sideboard);

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['archetypes', 'playerLists']);

onMounted(async () => {
	if (!props.eventId)
		return;

	if (!archetypeStore.isLoaded)
		await archetypeStore.loadByEventId(props.eventId);

	if (!playerListStore.isLoaded)
		await playerListStore.loadByEventId(props.eventId);
});

const archetypeOptions = computed(() => [
	{ label: 'Select an archetype…', value: null },
	...archetypeStore.archetypes.map(archetype => ({ label: archetype.name, value: archetype.id })),
]);

const boardOptions = [
	{ label: 'Full Deck', value: 'full' },
	{ label: 'Mainboard', value: 'mainboard' },
	{ label: 'Sideboard', value: 'sideboard' },
];

// The Archetype's pilots the Screen pages, read and followed as its Screen Output reads and follows them, so
// the page count is the one it renders (#780).
const { rowCount, loading: loadingPilots, answered: rowsAnswered } = useEditedScreenModeData(
	{
		screen: () => props.screen,
		eventId: () => props.eventId,
		saving: () => saving.value,
	},
	useArchetypeSpotlightModeData,
);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape. An edit
// changing which pilots show returns to page 1 as well.
const rotation = useRotationConfigWrites({
	mode: 'archetype-spotlight',
	config,
	rowCount,
	saveConfig,
});
const { updateConfig } = rotation;

/** For a closed card's summary: how many Screen Theme Overrides the Looks of the mounted `group` holds. */
function look(group: string) {
	return lookSummary('archetype-spotlight', props.screen.themeOverrides, [group]);
}

const topCardsSummary = computed(() => settingsSummary([
	`Top ${config.value.cardLimit}`,
	hasSideboard.value && boardOptions.find(option => option.value === config.value.board)?.label,
	look('top-cards'),
]));
const pilotsSummary = computed(() => paginationSummary(rotation));
const headerCardSummary = computed(() => headerSummary(config.value));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="archetype-spotlight:data" title="Data" :collapsible="false">
			<ScreenSettingsField label="Archetype" description="The archetype to spotlight.">
				<USelect
					:model-value="config.archetypeId ?? null"
					:items="archetypeOptions"
					class="w-64"
					@update:model-value="updateConfig({ archetypeId: $event ?? null, currentPage: 1 })"
				/>
			</ScreenSettingsField>

			<ScreenMetagameScopeFields
				:config="config"
				:fields="fields"
				:description="readsStandings
					? 'Which players count towards the pilots, meta share and Conversion Rate.'
					: 'Which players count towards the pilots and meta share.'"
				@update="updateConfig({ ...$event, currentPage: 1 })"
			/>

			<ScreenConversionTargetField v-if="readsStandings" :event-id="eventId" />
		</ScreenSettingsSection>

		<ScreenSettingsSection id="archetype-spotlight:top-cards" title="Top Cards" :summary="topCardsSummary">
			<ScreenConfigField
				:field="fields.cardLimit"
				:model-value="config.cardLimit"
				description="How many of the archetype's most-included cards to show."
				@update:model-value="$event !== null && updateConfig({ cardLimit: Number($event) })"
			/>

			<ScreenConfigField
				v-if="hasSideboard"
				:field="fields.board"
				:model-value="config.board"
				:items="boardOptions"
				description="Count cards from this part of each deck."
				@update:model-value="$event !== null && updateConfig({ board: $event as BoardSelection })"
			/>

			<ScreenCardTypeFilterField
				:excluded="config.excludedCardTypes"
				:game="game"
				:description="game === 'op'
					? 'Toggle which card types appear among the top cards; Leaders never do.'
					: 'Toggle which card types appear among the top cards; basic lands never do.'"
				test-id-prefix="archetype-spotlight-type"
				@update="updateConfig({ excludedCardTypes: $event })"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="top-cards" />
		</ScreenSettingsSection>

		<ScreenPaginationSettingsCard
			id="archetype-spotlight:pilots"
			title="Pilots"
			:summary="pilotsSummary"
			:rotation="rotation"
			page-size-description="Number of pilots shown per page."
			auto-page-description="Automatically cycle through pages of pilots."
			:loading="loadingPilots"
			:counting="!rowsAnswered"
		/>

		<ScreenHeaderSettingsCard
			id="archetype-spotlight:header"
			:summary="headerCardSummary"
			:config="config"
			:fields="fields"
			show-description="Show the title above the spotlight."
			auto-description="Leave empty for the archetype's name and scope."
			@update="updateConfig($event)"
		/>
	</div>
</template>
