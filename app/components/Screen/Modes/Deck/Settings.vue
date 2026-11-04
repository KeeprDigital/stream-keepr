<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { BoardSelection, SideboardPlacement, SideboardView } from '~~/shared/types/enums';
import type { ResolvedDeckBoardLayout, ResolvedSideboardLayout } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { DECK_SIDEBOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_COMPANION_TAG_POSITION, DEFAULT_DECK_TEXT_SIZES, DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { SIDEBOARD_PLACEMENT_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';
import { FOLLOWS_THE_THEME, lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const playerStore = usePlayerStore();
const eventStore = useEventStore();
const broadcastDeckListStore = useBroadcastDeckListStore();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'deck',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498):
// the mode's own fields, and the layout block each board carries. The boards'
// blocks label and bound their knobs alike; only their views differ.
const fields = screenModeConfigContract('deck').fields;
const boardFields = DECK_SIDEBOARD_LAYOUT_FIELDS;

/** A One Piece Card Game Event shows a Feature Match Slot side's or a Player's Deck List, set up in its own settings (ADR-0057, ADR-0074). */
const isOpEvent = computed(() => eventStore.event?.game === 'op');

const broadcastDeckListsEnabled = computed(() =>
	eventStore.event?.game === 'mtg'
	&& eventStore.event.broadcastDeckListsEnabled,
);
const sourceTab = ref<'player' | 'broadcast'>(
	config.value.deckSource.type === 'broadcast' && broadcastDeckListsEnabled.value
		? 'broadcast'
		: 'player',
);
const sourceTabs: TabsItem[] = [
	{ label: 'Player Deck', value: 'player', icon: 'i-lucide-user' },
	{ label: 'Broadcast Deck List', value: 'broadcast', icon: 'i-lucide-radio' },
];
const selectedBroadcastDeckListId = computed(() => config.value.deckSource.type === 'broadcast'
	? config.value.deckSource.broadcastDeckListId
	: null);
const broadcastDeckListOptions = computed(() => [
	{ label: 'Select a Broadcast Deck List…', value: null },
	...broadcastDeckListStore.summaries.map(list => ({ label: list.name, value: list.id })),
]);
const isBroadcastSource = computed(() => config.value.deckSource.type === 'broadcast');
// Card points come from the Event's points system; a Broadcast Deck List carries none.
const showsCardPoints = computed(() => !isBroadcastSource.value && !!eventStore.event?.pointsSystem);
/** The Deck Details row shows only with something in it, so its look settings show only then. */
const showsDetailsRow = computed(() =>
	!!config.value.showDeckStats
	|| (showsCardPoints.value && config.value.showHighlanderTotal !== false));

function selectBroadcastDeckList(listId: number | null) {
	if (listId !== null) {
		updateConfig({
			deckSource: { type: 'broadcast', broadcastDeckListId: listId },
		});
	}
}

watch(() => config.value.deckSource.type, (source) => {
	if (source === 'player' || (source === 'broadcast' && broadcastDeckListsEnabled.value))
		sourceTab.value = source;
});

watch(broadcastDeckListsEnabled, (enabled, wasEnabled) => {
	if (!enabled) {
		sourceTab.value = 'player';
		return;
	}
	if (!wasEnabled) {
		if (config.value.deckSource.type === 'broadcast')
			sourceTab.value = 'broadcast';
		void broadcastDeckListStore.loadCollection(props.eventId);
	}
});

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players']);

// Merely loading choices or opening a tab never changes the selected source.
onMounted(async () => {
	if (props.eventId && !isOpEvent.value) {
		await Promise.allSettled([
			playerStore.loadPlayersByEventId(props.eventId),
			...(broadcastDeckListsEnabled.value
				? [
						broadcastDeckListStore.loadCollection(props.eventId),
					]
				: []),
		]);
	}
});

// Players with deck lists (deckName in gameData is the proxy for having a deck)
const playersWithDecks = computed(() => {
	return playerStore.players.filter(p => getMtgGameData(p.gameData).deckName);
});

const playerOptions = computed(() => {
	return [
		{ label: 'Select a player…', value: null },
		...playersWithDecks.value.map((p) => {
			const deckName = getMtgGameData(p.gameData).deckName;
			return {
				label: `${p.name}${deckName
					? ` - ${deckName}`
					: ''}`,
				value: p.id,
			};
		}),
	];
});

const resolvedBoards = computed(() => resolveDeckBoards(config.value));
const board = computed<BoardSelection>(() => resolvedBoards.value.board);

// Per-board view tabs. Only the sideboard stacks, and only as the strip beside
// the mainboard (ADR-0054); elsewhere its stack shows as a grid, so the tab
// stays, disabled, rather than lose a stack that would return beside.
const sideboardCanStack = computed(() =>
	board.value === 'full' && resolvedBoards.value.sideboardPlacement === 'beside');
const gridViewTab = { label: 'Grid', value: 'grid', icon: 'i-lucide-grid-3x3' };
const listViewTab = { label: 'List', value: 'list', icon: 'i-lucide-list' };
const mainboardViewTabs = [gridViewTab, listViewTab];
const sideboardViewTabs = computed(() => [
	gridViewTab,
	{
		label: 'Stack',
		value: 'stack',
		icon: 'i-lucide-layers',
		disabled: !sideboardCanStack.value,
	},
	listViewTab,
]);

type BoardKey = 'mainboard' | 'sideboard';

interface BoardSection {
	key: BoardKey;
	title: string;
	layout: ResolvedDeckBoardLayout;
	viewTabs: { label: string; value: string; icon: string; disabled?: boolean }[];
	/** The view its Screen renders: a stack that cannot stack shows as a grid. */
	view: SideboardView;
	/** Whether the Screen shows the board; the last one shown cannot be hidden. */
	shown: boolean;
}

// Each board is shown or hidden on its own card. `board` stores the pair, so
// both hidden cannot be written: the last board shown keeps its toggle locked on.
const mainboardShown = computed(() => board.value !== 'sideboard');
const sideboardShown = computed(() => board.value !== 'mainboard');

/**
 * Both boards shown and Fit are laid out together at one card size. Along the
 * axis they share, the mainboard's alignment places them as one group; across
 * it, each board sits at its own, as far as the Screen's edge.
 */
const boardsPlacedTogether = computed(() =>
	mainboardShown.value
	&& sideboardShown.value
	&& [resolvedBoards.value.mainboard, resolvedBoards.value.sideboard].every(layout => layout.cardSizing === 'fit' && layout.view !== 'list'));

function alignmentDescription(key: BoardKey): string {
	if (!boardsPlacedTogether.value)
		return 'Where the cards sit when they don\'t fill the board\'s space. A Fixed grid places them across only.';
	const beside = resolvedBoards.value.sideboardPlacement === 'beside';
	if (key === 'mainboard') {
		return beside
			? 'Across, where both boards sit together; up and down, where the mainboard sits.'
			: 'Up and down, where both boards sit together; across, where the mainboard sits.';
	}
	return beside
		? 'Up and down, where the sideboard sits, top to bottom of the screen. Right sends it to the right edge; otherwise it sits beside the mainboard.'
		: 'Across, where the sideboard and its heading sit, edge to edge. Bottom sends it to the bottom of the screen; otherwise it sits under the mainboard.';
}

function setBoardShown(key: BoardKey, shown: boolean) {
	const mainboard = key === 'mainboard'
		? shown
		: mainboardShown.value;
	const sideboard = key === 'sideboard'
		? shown
		: sideboardShown.value;
	if (!mainboard && !sideboard)
		return;
	updateConfig({
		board: mainboard && sideboard
			? 'full'
			: mainboard ? 'mainboard' : 'sideboard',
	});
}

const boardSections = computed<BoardSection[]>(() => {
	const mainboard = resolvedBoards.value.mainboard;
	const sideboard = resolvedBoards.value.sideboard;
	return [
		{
			key: 'mainboard',
			title: 'Mainboard',
			layout: mainboard,
			viewTabs: mainboardViewTabs,
			view: mainboard.view,
			shown: mainboardShown.value,
		},
		{
			key: 'sideboard',
			title: 'Sideboard',
			layout: sideboard,
			viewTabs: sideboardViewTabs.value,
			view: sideboard.view === 'stack' && !sideboardCanStack.value
				? 'grid'
				: sideboard.view,
			shown: sideboardShown.value,
		},
	];
});

// The mode-config PATCH replaces a board block wholesale, so every knob change
// writes the complete resolved block back.
function updateBoardLayout(key: BoardKey, patch: Partial<ResolvedSideboardLayout>) {
	updateConfig({
		[key]: {
			...resolvedBoards.value[key],
			...patch,
		},
	});
}

// Empty-sideboard hint (#477/#478): the output renders nothing for an empty
// sideboard by design, so the control surface is the place that says so.
const deckCache = usePlayerDeckCache();
const sideboardEmpty = ref(false);
const sideboardLookup = createGuardedSequence();
const selectedPlayerId = computed(() => config.value.deckSource.type === 'player'
	? config.value.deckSource.playerId
	: null);

watch([
	selectedPlayerId,
	() => playerStore.players,
], async ([playerId]) => {
	const flight = sideboardLookup.begin();
	sideboardEmpty.value = false;
	if (!playerId) {
		return;
	}

	const player = playerStore.players.find(p => p.id === playerId);
	if (!player) {
		return;
	}

	try {
		const deck = await deckCache.fetchDeck(playerId, props.eventId, player.updatedAt);
		if (flight.stale) {
			return;
		}
		sideboardEmpty.value = !!deck && !deck.cards.some(card => card.compartment === 'sideboard');
	}
	catch {
		// The hint is a convenience; a failed deck fetch just leaves it off.
	}
}, { immediate: true });

const emptyBoardHint = computed(() => {
	const deckSource = config.value.deckSource;
	if (deckSource.type === 'broadcast') {
		const summary = broadcastDeckListStore.summaries.find(list => list.id === deckSource.broadcastDeckListId);
		if (!summary)
			return null;
		const mainboardShown = board.value !== 'sideboard';
		const sideboardShown = board.value !== 'mainboard';
		if (mainboardShown && sideboardShown && summary.mainboardQuantity === 0 && summary.sideboardQuantity === 0)
			return 'This Broadcast Deck List has no cards, so the output shows only its header.';
		if (mainboardShown && summary.mainboardQuantity === 0)
			return 'This Broadcast Deck List has no mainboard cards, so the output shows nothing for the mainboard.';
		if (sideboardShown && summary.sideboardQuantity === 0)
			return 'This Broadcast Deck List has no sideboard cards, so the output shows nothing for the sideboard.';
		return null;
	}
	return board.value !== 'mainboard' && sideboardEmpty.value
		? 'This player\'s deck has no sideboard cards, so the output shows nothing for the sideboard.'
		: null;
});

/** For a closed card's summary: how many Screen Theme Overrides the Looks of mounted `groups` hold. */
function look(...groups: string[]) {
	return lookSummary('deck', props.screen.themeOverrides, groups);
}

const headerCardSummary = computed(() => settingsSummary([
	[
		config.value.showPlayerName !== false && (isBroadcastSource.value ? 'List name' : 'Player name'),
		config.value.showDeckName !== false && (isBroadcastSource.value ? 'archetype' : 'deck name'),
		config.value.showDeckColors !== false && 'colours',
	].filter(Boolean).join(', ') || 'Nothing shown',
	look('header'),
]));
const detailsSummary = computed(() => settingsSummary([
	showsDetailsRow.value
		? 'Shown'
		: 'Hidden',
	look('deck-details', ...(showsCardPoints.value
		? ['pointed-cards']
		: [])),
]));

const BOARD_VIEW_LABELS: Record<SideboardView, string> = { grid: 'Grid', stack: 'Stack', list: 'List' };

function boardSummary(section: BoardSection): string {
	if (!section.shown)
		return 'Hidden';
	return settingsSummary([
		BOARD_VIEW_LABELS[section.view],
		section.view !== 'list' && (section.layout.cardSizing === 'fixed' || section.view === 'stack'
			? `${section.layout.cardWidth} px cards`
			: 'Fit'),
	]);
}

const cardLookSummary = computed(() => settingsSummary([
	look('card-look'),
], FOLLOWS_THE_THEME));
const badgesSummary = computed(() => {
	const shown = [
		config.value.showQuantities && 'Quantity',
		showsCardPoints.value && config.value.showHighlanderPoints && 'Point',
		config.value.showCompanion !== false && 'Companion',
	].filter(Boolean);
	return settingsSummary([
		shown.length > 0
			? `${shown.join(', ')} ${shown.length === 1
				? 'badge'
				: 'badges'}`
			: 'No badges',
		look('quantity-badge', ...(showsCardPoints.value
			? ['points-badge']
			: [])),
	]);
});
</script>

<template>
	<ScreenModesDeckOpSettings
		v-if="isOpEvent"
		:screen="screen"
		:config="config"
		:event-id="eventId"
		@update="updateConfig"
	/>
	<div v-else class="flex flex-col gap-6">
		<ScreenSettingsCard id="deck:deck-source" title="Deck Source" :collapsible="false">
			<UTabs
				v-if="broadcastDeckListsEnabled"
				v-model="sourceTab"
				:items="sourceTabs"
				:content="false"
			/>

			<ScreenSettingsField
				v-if="!broadcastDeckListsEnabled || sourceTab === 'player'"
				label="Player"
				description="Select a player with a deck list to show."
				:class="{ 'mt-5': broadcastDeckListsEnabled }"
			>
				<USelect
					:model-value="selectedPlayerId"
					:items="playerOptions"
					class="w-64"
					@update:model-value="updateConfig({ deckSource: { type: 'player', playerId: $event } })"
				/>
			</ScreenSettingsField>

			<div v-else class="mt-5 space-y-3">
				<ScreenSettingsField
					label="Broadcast Deck List"
					description="Choose a list prepared in Event Settings → Broadcast."
				>
					<USelect
						:model-value="selectedBroadcastDeckListId"
						:items="broadcastDeckListOptions"
						class="w-96"
						@update:model-value="selectBroadcastDeckList($event)"
					/>
				</ScreenSettingsField>
				<p v-if="broadcastDeckListStore.summaries.length === 0" class="text-xs text-muted">
					No Broadcast Deck Lists are available. Create one in Event Settings → Broadcast.
				</p>
			</div>
		</ScreenSettingsCard>

		<ScreenSettingsCard id="deck:header" title="Header" :summary="headerCardSummary">
			<!-- A Broadcast Deck List names a list and its archetype, so these two toggles say so. -->
			<ScreenSettingsToggle
				:data-config-field="fields.showPlayerName.key"
				:label="isBroadcastSource ? 'Show List Name' : fields.showPlayerName.label"
				:description="isBroadcastSource ? 'The Broadcast Deck List\'s name, on the first line.' : 'The Player\'s name, on the first line.'"
				:model-value="config.showPlayerName !== false"
				@update:model-value="updateConfig({ showPlayerName: $event })"
			/>
			<ScreenSettingsToggle
				:data-config-field="fields.showDeckName.key"
				:label="isBroadcastSource ? 'Show Archetype' : fields.showDeckName.label"
				:description="isBroadcastSource ? 'The list\'s archetype, beside its name.' : 'The deck\'s name, beside the Player\'s.'"
				:model-value="config.showDeckName !== false"
				@update:model-value="updateConfig({ showDeckName: $event })"
			/>
			<ScreenConfigField
				:field="fields.showDeckColors"
				:model-value="config.showDeckColors !== false"
				description="The deck's mana colours, beside its name."
				@update:model-value="updateConfig({ showDeckColors: $event === true })"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenSettingsCard>

		<ScreenSettingsCard id="deck:deck-details" title="Deck Details" :summary="detailsSummary">
			<p class="text-xs text-muted">
				A row under the header, shown only when something in it is on.
			</p>

			<ScreenConfigField
				:field="fields.showDeckStats"
				:model-value="!!config.showDeckStats"
				description="Card counts by type: creatures, instants and so on."
				@update:model-value="updateConfig({ showDeckStats: $event === true })"
			/>

			<ScreenConfigField
				v-if="showsCardPoints"
				:field="fields.showHighlanderTotal"
				:model-value="config.showHighlanderTotal !== false"
				description="The deck's total 7 Point Highlander points."
				@update:model-value="updateConfig({ showHighlanderTotal: $event === true })"
			/>

			<template v-if="showsDetailsRow">
				<ScreenConfigField
					:field="fields.metaPillSize"
					:model-value="config.metaPillSize ?? DEFAULT_DECK_TEXT_SIZES.metaPillSize"
					description="The row's text size in px; a pill sizes itself around it."
					@update:model-value="$event !== null && updateConfig({ metaPillSize: Number($event) })"
				/>

				<ScreenConfigField
					:field="fields.showDeckMetaPill"
					:model-value="config.showDeckMetaPill !== false"
					description="Wrap the row in a pill."
					@update:model-value="updateConfig({ showDeckMetaPill: $event === true })"
				/>
			</template>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="deck-details" />

			<ScreenSettingsGroup v-if="showsCardPoints" title="Pointed Cards">
				<ScreenConfigField
					:field="fields.showHighlanderPointedCards"
					:model-value="config.showHighlanderPointedCards !== false"
					description="A chip per pointed card, under the row."
					@update:model-value="updateConfig({ showHighlanderPointedCards: $event === true })"
				/>

				<ScreenConfigField
					v-if="config.showHighlanderPointedCards !== false"
					:field="fields.pointedCardSize"
					:model-value="config.pointedCardSize ?? DEFAULT_DECK_TEXT_SIZES.pointedCardSize"
					description="Each chip's text size in px; the chip sizes itself around it."
					@update:model-value="$event !== null && updateConfig({ pointedCardSize: Number($event) })"
				/>

				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="pointed-cards" />
			</ScreenSettingsGroup>
		</ScreenSettingsCard>

		<ScreenSettingsCard
			v-for="section in boardSections"
			:id="`deck:${section.key}`"
			:key="section.key"
			:title="section.title"
			:summary="boardSummary(section)"
		>
			<ScreenSettingsToggle
				:label="`Show ${section.title}`"
				:description="section.shown && !(mainboardShown && sideboardShown)
					? 'The only board shown, so it stays on; show the other board to hide this one.'
					: `Show the ${section.title.toLowerCase()} on the Screen.`"
				:model-value="section.shown"
				@update:model-value="setBoardShown(section.key, !!$event)"
			/>

			<p
				v-if="section.key === 'sideboard' && emptyBoardHint"
				data-testid="empty-sideboard-hint"
				class="text-xs text-muted"
			>
				{{ emptyBoardHint }}
			</p>

			<template v-if="section.key === 'sideboard'">
				<ScreenConfigField
					v-if="mainboardShown && sideboardShown"
					:field="fields.sideboardPlacement"
					:model-value="resolvedBoards.sideboardPlacement"
					:items="SIDEBOARD_PLACEMENT_SELECT_OPTIONS"
					description="Where the sideboard sits relative to the mainboard."
					@update:model-value="$event !== null && updateConfig({ sideboardPlacement: $event as SideboardPlacement })"
				/>

				<ScreenConfigField
					:field="fields.showCompanion"
					:model-value="config.showCompanion !== false"
					description="The deck's companion as the sideboard's first card."
					@update:model-value="updateConfig({ showCompanion: $event === true })"
				/>
			</template>

			<template v-if="section.shown">
				<USeparator />

				<ScreenSettingsField
					:data-config-field="boardFields.view.key"
					:label="boardFields.view.label"
					:description="`How the ${section.title.toLowerCase()} cards are shown.`"
				>
					<UISegmentedTabs
						:items="section.viewTabs"
						:model-value="section.view"
						size="sm"
						@update:model-value="updateBoardLayout(section.key, { view: $event as SideboardView })"
					/>
				</ScreenSettingsField>

				<USeparator />

				<ScreenCardGridLayoutFields
					v-if="section.view !== 'list'"
					:view="section.view"
					:layout="section.layout"
					:fields="boardFields"
					:show="{ alignment: true, stackReveal: section.view === 'stack' }"
					:descriptions="{ alignment: alignmentDescription(section.key) }"
					:grid-name="section.title"
					@update="updateBoardLayout(section.key, $event)"
				/>

				<ScreenConfigField
					v-else
					:field="boardFields.listColumns"
					:model-value="section.layout.listColumns"
					description="Number of columns in the list."
					@update:model-value="$event !== null && updateBoardLayout(section.key, { listColumns: Number($event) })"
				/>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard
			id="deck:card-look"
			title="Card Look"
			subtitle="How both boards' cards read."
			:summary="cardLookSummary"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="card-look" />
		</ScreenSettingsCard>

		<ScreenSettingsCard id="deck:card-badges" title="Card Badges" :summary="badgesSummary">
			<ScreenCardBadgeFields
				title="Quantity Badge"
				:shown="!!config.showQuantities"
				:shown-field="fields.showQuantities"
				shown-description="Show quantity badges on cards with multiple copies."
				:position="config.quantityPosition ?? DEFAULT_QUANTITY_POSITION"
				:position-field="fields.quantityPosition"
				:text-size="config.quantityBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.quantityBadgeSize"
				:size-field="fields.quantityBadgeSize"
				@update="updateConfig($event)"
			>
				<template #look>
					<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="quantity-badge" />
				</template>
			</ScreenCardBadgeFields>

			<template v-if="showsCardPoints">
				<USeparator />

				<ScreenCardBadgeFields
					title="Highlander Point Badge"
					:shown="!!config.showHighlanderPoints"
					:shown-field="fields.showHighlanderPoints"
					shown-description="Show 7 Point Highlander point badges on pointed cards."
					:position="config.highlanderPointsPosition ?? DEFAULT_HIGHLANDER_POINTS_POSITION"
					:position-field="fields.highlanderPointsPosition"
					position-description="Where the point badge appears on the card in grid mode."
					:text-size="config.pointsBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.pointsBadgeSize"
					:size-field="fields.pointsBadgeSize"
					@update="updateConfig($event)"
				>
					<template #look>
						<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="points-badge" />
					</template>
				</ScreenCardBadgeFields>
			</template>

			<template v-if="config.showCompanion !== false">
				<USeparator />

				<ScreenCardBadgeFields
					title="Companion Badge"
					shown
					:position="config.companionTagPosition ?? DEFAULT_COMPANION_TAG_POSITION"
					:position-field="fields.companionTagPosition"
					position-description="Where the Companion badge sits on its card; in a corner, it lines up with that side."
					@update="updateConfig($event)"
				/>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
