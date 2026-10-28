<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { BoardSelection, CardSizing, QuantityPosition, SideboardPlacement, SideboardView } from '~~/shared/types/enums';
import type { ResolvedDeckBoardLayout, ResolvedSideboardLayout } from '~~/shared/types/screenConfig';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import type { Screen } from '~/types';
import { DECK_SIDEBOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { CARD_SIZING_SELECT_OPTIONS, SIDEBOARD_PLACEMENT_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';
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

// A badge in the centre of a Deck Screen card would cover its art, so the badge
// position pickers offer every point but this one — which is why what they emit
// is always a `QuantityPosition`, and why the casts below are safe.
const BADGE_DISABLED_POINTS: readonly NinePoint[] = ['center'];

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
	if (source === 'player' || broadcastDeckListsEnabled.value)
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
	if (props.eventId) {
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
// the mainboard (ADR-0053); elsewhere its stack shows as a grid, so the tab
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
 * Both boards shown and Fit are laid out together at one card size and placed
 * as one group at the mainboard's alignment; the sideboard's places it along
 * the mainboard, so the group keeps the same space to the Screen's edges.
 */
const boardsPlacedTogether = computed(() =>
	mainboardShown.value
	&& sideboardShown.value
	&& [resolvedBoards.value.mainboard, resolvedBoards.value.sideboard].every(layout => layout.cardSizing === 'fit' && layout.view !== 'list'));

function alignmentDescription(key: BoardKey): string {
	if (!boardsPlacedTogether.value)
		return 'Where the cards sit when they don\'t fill the board\'s space. A Fixed grid places them across only.';
	if (key === 'mainboard')
		return 'Where both boards sit, together, in the space they leave over.';
	return resolvedBoards.value.sideboardPlacement === 'beside'
		? 'Where the sideboard sits up or down beside the mainboard.'
		: 'Where the sideboard sits across under the mainboard.';
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
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Deck Source">
			<UTabs
				v-if="broadcastDeckListsEnabled"
				v-model="sourceTab"
				:items="sourceTabs"
				:content="false"
			/>

			<UFormField
				v-if="!broadcastDeckListsEnabled || sourceTab === 'player'"
				label="Player"
				description="Select a player with a deck list to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
				:class="{ 'mt-5': broadcastDeckListsEnabled }"
			>
				<USelect
					:model-value="selectedPlayerId"
					:items="playerOptions"
					class="w-64"
					@update:model-value="updateConfig({ deckSource: { type: 'player', playerId: $event } })"
				/>
			</UFormField>

			<div v-else class="mt-5 space-y-3">
				<UFormField
					label="Broadcast Deck List"
					description="Choose a list prepared in Event Settings → Broadcast."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="selectedBroadcastDeckListId"
						:items="broadcastDeckListOptions"
						class="w-96"
						@update:model-value="selectBroadcastDeckList($event)"
					/>
				</UFormField>
				<p v-if="broadcastDeckListStore.summaries.length === 0" class="text-xs text-muted">
					No Broadcast Deck Lists are available. Create one in Event Settings → Broadcast.
				</p>
			</div>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="isBroadcastSource ? 'Show List Name' : fields.showPlayerName.label"
				:description="isBroadcastSource ? 'The Broadcast Deck List\'s name, on the first line.' : 'The Player\'s name, on the first line.'"
				:model-value="config.showPlayerName !== false"
				@update:model-value="updateConfig({ showPlayerName: $event })"
			/>
			<ScreenSettingsToggle
				:label="isBroadcastSource ? 'Show Archetype' : fields.showDeckName.label"
				:description="isBroadcastSource ? 'The list\'s archetype, beside its name.' : 'The deck\'s name, beside the Player\'s.'"
				:model-value="config.showDeckName !== false"
				@update:model-value="updateConfig({ showDeckName: $event })"
			/>
			<ScreenSettingsToggle
				:label="fields.showDeckColors.label"
				description="The deck's mana colours, beside its name."
				:model-value="config.showDeckColors !== false"
				@update:model-value="updateConfig({ showDeckColors: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Deck Details">
			<p class="text-xs text-muted">
				A row under the header. Shown only when something in it is on.
			</p>

			<ScreenSettingsToggle
				:label="fields.showDeckStats.label"
				description="Card counts by type: creatures, instants and so on."
				:model-value="config.showDeckStats"
				@update:model-value="updateConfig({ showDeckStats: $event })"
			/>

			<ScreenSettingsToggle
				v-if="showsCardPoints"
				:label="fields.showHighlanderTotal.label"
				description="The deck's total 7 Point Highlander points."
				:model-value="config.showHighlanderTotal !== false"
				@update:model-value="updateConfig({ showHighlanderTotal: $event })"
			/>

			<template v-if="showsDetailsRow">
				<UFormField
					:label="fields.metaPillSize.label"
					description="The row's text size in px; a pill sizes itself around it."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.metaPillSize ?? DEFAULT_DECK_TEXT_SIZES.metaPillSize"
						:min="fields.metaPillSize.min"
						:max="fields.metaPillSize.max"
						class="w-32"
						@update:model-value="updateConfig({ metaPillSize: Number($event) })"
					/>
				</UFormField>

				<ScreenSettingsToggle
					:label="fields.showDeckMetaPill.label"
					description="Wrap the row in a pill."
					:model-value="config.showDeckMetaPill !== false"
					@update:model-value="updateConfig({ showDeckMetaPill: $event })"
				/>
			</template>

			<template v-if="showsCardPoints">
				<USeparator />

				<ScreenSettingsToggle
					:label="fields.showHighlanderPointedCards.label"
					description="A chip per pointed card, under the row."
					:model-value="config.showHighlanderPointedCards !== false"
					@update:model-value="updateConfig({ showHighlanderPointedCards: $event })"
				/>

				<UFormField
					v-if="config.showHighlanderPointedCards !== false"
					:label="fields.pointedCardSize.label"
					description="Each chip's text size in px; the chip sizes itself around it."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.pointedCardSize ?? DEFAULT_DECK_TEXT_SIZES.pointedCardSize"
						:min="fields.pointedCardSize.min"
						:max="fields.pointedCardSize.max"
						class="w-32"
						@update:model-value="updateConfig({ pointedCardSize: Number($event) })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard
			v-for="section in boardSections"
			:key="section.key"
			:title="section.title"
		>
			<ScreenSettingsToggle
				:label="`Show ${section.title}`"
				:description="section.shown && !(mainboardShown && sideboardShown)
					? 'The only board shown, so it stays on. Show the other board to hide this one.'
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
				<UFormField
					v-if="mainboardShown && sideboardShown"
					:label="fields.sideboardPlacement.label"
					description="Where the sideboard sits relative to the mainboard."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="resolvedBoards.sideboardPlacement"
						:items="SIDEBOARD_PLACEMENT_SELECT_OPTIONS"
						class="w-48"
						@update:model-value="updateConfig({ sideboardPlacement: $event as SideboardPlacement })"
					/>
				</UFormField>

				<ScreenSettingsToggle
					:label="fields.showCompanion.label"
					description="The deck's companion as the sideboard's first card."
					:model-value="config.showCompanion !== false"
					@update:model-value="updateConfig({ showCompanion: $event })"
				/>
			</template>

			<template v-if="section.shown">
				<USeparator />

				<UFormField
					:label="boardFields.view.label"
					:description="`How the ${section.title.toLowerCase()} cards are shown.`"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UISegmentedTabs
						:items="section.viewTabs"
						:model-value="section.view"
						size="sm"
						@update:model-value="updateBoardLayout(section.key, { view: $event as SideboardView })"
					/>
				</UFormField>

				<USeparator />

				<UFormField
					v-if="section.view !== 'list'"
					:label="boardFields.cardSizing.label"
					description="Fit shrinks the cards until every one fits the screen. Fixed takes the card width below and may run off the screen."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="section.layout.cardSizing"
						:items="CARD_SIZING_SELECT_OPTIONS"
						class="w-48"
						@update:model-value="updateBoardLayout(section.key, { cardSizing: $event as CardSizing })"
					/>
				</UFormField>

				<UFormField
					v-if="section.view !== 'list'"
					:label="boardFields.alignment.label"
					:description="alignmentDescription(section.key)"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UINinePointPicker
						:model-value="section.layout.alignment"
						:aria-label="`${section.title} alignment`"
						@update:model-value="updateBoardLayout(section.key, { alignment: $event as NinePoint })"
					/>
				</UFormField>

				<UFormField
					v-if="section.view === 'stack' || (section.view === 'grid' && section.layout.cardSizing === 'fixed')"
					:label="boardFields.cardWidth.label"
					description="Each card's width in px."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="section.layout.cardWidth"
						:min="boardFields.cardWidth.min"
						:max="boardFields.cardWidth.max"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { cardWidth: Number($event) })"
					/>
				</UFormField>

				<UFormField
					v-if="section.view === 'stack'"
					:label="boardFields.stackReveal.label"
					description="How much of each stacked card but the last shows, in px."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="resolvedBoards.sideboard.stackReveal"
						:min="boardFields.stackReveal.min"
						:max="boardFields.stackReveal.max"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { stackReveal: Number($event) })"
					/>
				</UFormField>

				<template v-if="section.view === 'grid'">
					<ScreenSettingsToggle
						:label="boardFields.autoColumns.label"
						description="Choose the columns from the card count and the screen's size."
						:model-value="section.layout.autoColumns"
						@update:model-value="updateBoardLayout(section.key, { autoColumns: $event })"
					/>

					<UFormField
						v-if="!section.layout.autoColumns"
						:label="boardFields.columns.label"
						description="Number of columns in the card grid."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="section.layout.columns"
							:min="boardFields.columns.min"
							:max="boardFields.columns.max"
							class="w-32"
							@update:model-value="updateBoardLayout(section.key, { columns: Number($event) })"
						/>
					</UFormField>

					<UFormField
						:label="boardFields.cardGap.label"
						description="The space between cards in px."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="section.layout.cardGap"
							:min="boardFields.cardGap.min"
							:max="boardFields.cardGap.max"
							class="w-32"
							@update:model-value="updateBoardLayout(section.key, { cardGap: Number($event) })"
						/>
					</UFormField>
				</template>

				<template v-else-if="section.view === 'list'">
					<UFormField
						:label="boardFields.listColumns.label"
						description="Number of columns in the list."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="section.layout.listColumns"
							:min="boardFields.listColumns.min"
							:max="boardFields.listColumns.max"
							class="w-32"
							@update:model-value="updateBoardLayout(section.key, { listColumns: Number($event) })"
						/>
					</UFormField>
				</template>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Card Badges">
			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Quantity Badge
			</p>

			<ScreenSettingsToggle
				:label="fields.showQuantities.label"
				description="Show quantity badges on cards with multiple copies."
				:model-value="config.showQuantities"
				@update:model-value="updateConfig({ showQuantities: $event })"
			/>

			<template v-if="config.showQuantities">
				<USeparator />

				<UFormField
					:label="fields.quantityPosition.label"
					description="Where the badge appears on the card."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UINinePointPicker
						:model-value="config.quantityPosition ?? DEFAULT_QUANTITY_POSITION"
						:disabled-points="BADGE_DISABLED_POINTS"
						aria-label="Quantity badge position"
						@update:model-value="updateConfig({ quantityPosition: $event as QuantityPosition })"
					/>
				</UFormField>

				<UFormField
					:label="fields.quantityBadgeSize.label"
					description="The badge's text size in px; the badge sizes itself around it."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.quantityBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.quantityBadgeSize"
						:min="fields.quantityBadgeSize.min"
						:max="fields.quantityBadgeSize.max"
						class="w-32"
						@update:model-value="updateConfig({ quantityBadgeSize: Number($event) })"
					/>
				</UFormField>
			</template>

			<template v-if="showsCardPoints">
				<USeparator />

				<p class="text-xs font-semibold uppercase tracking-wider text-muted">
					Highlander Point Badges
				</p>

				<ScreenSettingsToggle
					:label="fields.showHighlanderPoints.label"
					description="Show 7 Point Highlander point badges on pointed cards."
					:model-value="config.showHighlanderPoints"
					@update:model-value="updateConfig({ showHighlanderPoints: $event })"
				/>

				<template v-if="config.showHighlanderPoints">
					<USeparator />

					<UFormField
						:label="fields.highlanderPointsPosition.label"
						description="Where the point badge appears on the card in grid mode."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UINinePointPicker
							:model-value="config.highlanderPointsPosition ?? DEFAULT_HIGHLANDER_POINTS_POSITION"
							:disabled-points="BADGE_DISABLED_POINTS"
							aria-label="Highlander point badge position"
							@update:model-value="updateConfig({ highlanderPointsPosition: $event as QuantityPosition })"
						/>
					</UFormField>

					<UFormField
						:label="fields.pointsBadgeSize.label"
						description="The badge's text size in px; the badge sizes itself around it."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="config.pointsBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.pointsBadgeSize"
							:min="fields.pointsBadgeSize.min"
							:max="fields.pointsBadgeSize.max"
							class="w-32"
							@update:model-value="updateConfig({ pointsBadgeSize: Number($event) })"
						/>
					</UFormField>
				</template>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
