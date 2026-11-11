<script setup lang="ts">
import type {
	BoardSelection,
	MetagameCardSortBy,
	TopCardsStat,
} from '~~/shared/types/enums';
import type { MetagameCardTypeBucket } from '~~/shared/utils/metagame';
import type { Screen } from '~/types';
import { getFeatureMatchStateTracking } from '~~/shared/config/games';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { getMetagameCardTypeBuckets } from '~~/shared/utils/metagame';
import { headerSummary, lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
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
	'top-cards',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('top-cards').fields;

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players', 'playerLists']);

onMounted(async () => {
	if (!props.eventId) {
		return;
	}

	if (!playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(props.eventId);
	}

	if (!playerListStore.isLoaded) {
		await playerListStore.loadByEventId(props.eventId);
	}
});

// The grid rows the Screen pages — the cards it reads, once the filters have
// applied, in rows of `columns` — read and followed as its Screen Output reads
// and follows them, so the page count is the one it renders (#780).
const { rowCount, loading: loadingCards, answered: rowsAnswered } = useEditedScreenModeData(
	{
		screen: () => props.screen,
		eventId: () => props.eventId,
		saving: () => saving.value,
	},
	useTopCardsModeData,
);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape. An edit
// changing which cards each page holds returns to page 1 as well.
const rotation = useRotationConfigWrites({
	mode: 'top-cards',
	config,
	rowCount,
	saveConfig,
});
const { updateConfig } = rotation;

// Paging is the ranking split into pages: on while a page holds fewer cards
// than the ranking does. Off stores the most a page can hold, so the ranking
// stays one page whatever its card count becomes.
const paged = computed(() => config.value.cardsPerPage < config.value.limit);

/** The page count is the one the Screen renders, from the cards it reads. */
const pageSizeDescription = computed(() => {
	const pages = rotation.totalPages.value;
	return `Cards on each page, laid out in as many columns as the Screen fits: ${pages} ${pages === 1
		? 'page'
		: 'pages'}.`;
});

function setPaged(enabled: boolean) {
	rotation.setPageSize(enabled
		? Math.ceil(config.value.limit / 2)
		: fields.cardsPerPage.max!);
}

const boardOptions = [
	{ label: 'Full Deck', value: 'full' },
	{ label: 'Mainboard', value: 'mainboard' },
	{ label: 'Sideboard', value: 'sideboard' },
];

const sortByOptions = [
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
];

const statBadgeOptions = [
	{ label: 'None', value: 'none' },
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
	{ label: 'Deck Count', value: 'deckCount' },
];

// Points come from the Event's points system. A Screen left filtering to
// pointed cards, or badging their points, keeps its toggle, so it can be
// turned back off.
// The Event's Card Game decides its card types, and whether a deck has a Sideboard or points (ADR-0074).
const game = computed(() => eventStore.event?.game);
const hasSideboard = computed(() => !game.value || getFeatureMatchStateTracking(game.value).sideboard);
// Highlander points are Magic's.
const hasPointsSystem = computed(() => game.value !== 'op' && !!eventStore.event?.pointsSystem);
const showsPointedOnly = computed(() => hasPointsSystem.value || config.value.pointedOnly);
const showsPointsBadges = computed(() => hasPointsSystem.value || config.value.showPointsBadges);

/** Ranking pointed cards keeps nonbasic lands in, whatever the Land filter holds. */
const lockedTypes = computed<MetagameCardTypeBucket[]>(() => config.value.pointedOnly
	? ['Land']
	: []);

const gridLayout = computed(() => ({
	cardSizing: config.value.cardSizing,
	cardWidth: config.value.cardWidth,
	cardGap: config.value.cardGap,
	autoColumns: config.value.autoColumns,
	columns: config.value.columns,
}));

const layoutDescriptions = {
	cardSizing: 'Fit shrinks the cards until every one on the page fits the screen; Fixed takes the card width below and may run off the screen.',
	autoColumns: 'Choose the columns from the space the cards have on the Screen.',
	columns: 'Number of cards per row.',
};

/** For a closed card's summary: how many Screen Theme Overrides the Looks of mounted `groups` hold. */
function look(...groups: string[]) {
	return lookSummary('top-cards', props.screen.themeOverrides, groups);
}

const filtersSummary = computed(() => {
	const offered = getMetagameCardTypeBuckets(game.value);
	const excluded = config.value.excludedCardTypes.filter(type => offered.includes(type) && !lockedTypes.value.includes(type)).length;
	return settingsSummary([
		config.value.pointedOnly && 'Pointed only',
		excluded > 0 && `${excluded} ${excluded === 1
			? 'type'
			: 'types'} excluded`,
	], 'Every card type');
});
const rankingSummary = computed(() => settingsSummary([
	`Top ${config.value.limit}`,
	paged.value
		? `${config.value.cardsPerPage} per page`
		: 'One page',
]));
const layoutSummary = computed(() => settingsSummary([
	config.value.cardSizing === 'fixed'
		? `Fixed ${config.value.cardWidth} px`
		: 'Fit',
	config.value.autoColumns
		? 'Auto columns'
		: `${config.value.columns} columns`,
]));
const headerCardSummary = computed(() => headerSummary(config.value));
const badgesSummary = computed(() => {
	const shown = [
		config.value.showRankBadges && 'Rank',
		config.value.statBadge !== 'none' && 'Stat',
		showsPointsBadges.value && config.value.showPointsBadges && 'Point',
	].filter(Boolean);
	return settingsSummary([
		shown.length > 0
			? `${shown.join(', ')} ${shown.length === 1
				? 'badge'
				: 'badges'}`
			: 'No badges',
		look('rank-badge', 'stat-badge', ...(showsPointsBadges.value
			? ['points-badge']
			: [])),
	]);
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="top-cards:data" title="Data" :collapsible="false">
			<ScreenMetagameScopeFields
				:config="config"
				:fields="fields"
				description="Which players to include in the ranking."
				@update="updateConfig({ ...$event, currentPage: 1 })"
			/>

			<ScreenConfigField
				v-if="hasSideboard"
				:field="fields.board"
				:model-value="config.board"
				:items="boardOptions"
				description="Count cards from this part of each deck."
				@update:model-value="$event !== null && updateConfig({ board: $event as BoardSelection, currentPage: 1 })"
			/>

			<ScreenConfigField
				:field="fields.sortBy"
				:model-value="config.sortBy"
				:items="sortByOptions"
				description="Order cards using this metric."
				@update:model-value="$event !== null && updateConfig({ sortBy: $event as MetagameCardSortBy, currentPage: 1 })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="top-cards:filters" title="Filters" :summary="filtersSummary">
			<ScreenConfigField
				v-if="showsPointedOnly"
				:field="fields.pointedOnly"
				:model-value="config.pointedOnly"
				description="Rank only cards the Event's points system gives points, pointed lands such as Strip Mine included."
				@update:model-value="updateConfig({ pointedOnly: $event === true, currentPage: 1 })"
			/>

			<ScreenCardTypeFilterField
				:excluded="config.excludedCardTypes"
				:locked="lockedTypes"
				:game="game"
				:description="game === 'op'
					? 'Toggle which card types appear in the ranking; Leaders never do.'
					: 'Toggle which card types appear in the ranking; basic lands never do.'"
				test-id-prefix="top-cards-type"
				@update="updateConfig({ excludedCardTypes: $event, currentPage: 1 })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="top-cards:ranking-and-pages" title="Ranking & Pages" :summary="rankingSummary">
			<ScreenConfigField
				:field="fields.limit"
				:model-value="config.limit"
				description="How many of the top cards the ranking shows."
				@update:model-value="$event !== null && updateConfig({ limit: Number($event), currentPage: 1 })"
			/>

			<ScreenSettingsToggle
				label="Split into pages"
				description="Show the cards a page at a time; off, every card is on one page."
				:model-value="paged"
				:enabled="config.limit > 1"
				disabled-description="A ranking of one card is one page."
				@update:model-value="setPaged($event === true)"
			/>

			<template v-if="paged">
				<ScreenConfigField
					:field="fields.cardsPerPage"
					:model-value="config.cardsPerPage"
					:max="config.limit - 1"
					:description="pageSizeDescription"
					@update:model-value="$event !== null && rotation.setPageSize(Number($event))"
				/>

				<USeparator />

				<ScreenPaginationRotationControls
					:rotation="rotation"
					auto-page-description="Automatically cycle through pages of cards."
					:loading="loadingCards"
					:counting="!rowsAnswered"
				/>
			</template>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="top-cards:layout" title="Layout" :summary="layoutSummary">
			<ScreenCardGridLayoutFields
				:layout="gridLayout"
				:fields="fields"
				:descriptions="layoutDescriptions"
				@update="updateConfig($event)"
			/>
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="top-cards:header"
			:summary="headerCardSummary"
			:config="config"
			:fields="fields"
			show-description="Show the title above the card grid."
			auto-description="Leave empty for an auto-generated title."
			@update="updateConfig($event)"
		/>

		<ScreenSettingsSection id="top-cards:card-badges" title="Card Badges" :summary="badgesSummary">
			<ScreenCardBadgeFields
				title="Rank Badge"
				:shown="config.showRankBadges"
				:shown-field="fields.showRankBadges"
				shown-description="Number each card by its position in the ranking."
				:position="config.rankBadgePosition"
				:position-field="fields.rankBadgePosition"
				:text-size="config.rankBadgeTextSize"
				:size-field="fields.rankBadgeTextSize"
				@update="updateConfig($event)"
			>
				<template #look>
					<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="rank-badge" />
				</template>
			</ScreenCardBadgeFields>

			<USeparator />

			<ScreenCardBadgeFields
				title="Stat Badge"
				:shown="config.statBadge !== 'none'"
				:position="config.statBadgePosition"
				:position-field="fields.statBadgePosition"
				:text-size="config.statBadgeTextSize"
				:size-field="fields.statBadgeTextSize"
				@update="updateConfig($event)"
			>
				<template #shown>
					<ScreenConfigField
						:field="fields.statBadge"
						:model-value="config.statBadge"
						:items="statBadgeOptions"
						description="Show one metric on each card."
						@update:model-value="$event !== null && updateConfig({ statBadge: $event as TopCardsStat })"
					/>
				</template>
				<template #look>
					<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="stat-badge" />
				</template>
			</ScreenCardBadgeFields>

			<template v-if="showsPointsBadges">
				<USeparator />

				<ScreenCardBadgeFields
					title="Point Badge"
					:shown="config.showPointsBadges"
					:shown-field="fields.showPointsBadges"
					shown-description="Show each pointed card's points from the Event's points system."
					:position="config.pointsBadgePosition"
					:position-field="fields.pointsBadgePosition"
					:text-size="config.pointsBadgeTextSize"
					:size-field="fields.pointsBadgeTextSize"
					@update="updateConfig($event)"
				>
					<template #look>
						<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="points-badge" />
					</template>
				</ScreenCardBadgeFields>
			</template>
		</ScreenSettingsSection>
	</div>
</template>
