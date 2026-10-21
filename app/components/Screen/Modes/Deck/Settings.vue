<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { BoardSelection, DeckBoardView, QuantityPosition, SideboardPlacement } from '~~/shared/types/enums';
import type { DeckBoardLayoutConfig, ResolvedDeckBoardLayout } from '~~/shared/types/screenConfig';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import type { Screen } from '~/types';
import { DECK_BOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { getMtgGameData } from '~~/shared/utils/gameData';
import {
	DECK_CARD_SIZE_SELECT_OPTIONS,
	QUANTITY_SIZE_SELECT_OPTIONS,
	SIDEBOARD_PLACEMENT_SELECT_OPTIONS,
} from '~~/shared/utils/selectOptions';
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
// the mode's own fields, and the layout block each board carries.
const fields = screenModeConfigContract('deck').fields;
const boardFields = DECK_BOARD_LAYOUT_FIELDS;

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

function selectBroadcastDeckList(listId: number | null) {
	if (listId !== null)
		updateConfig({ deckSource: { type: 'broadcast', broadcastDeckListId: listId } });
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
				? [broadcastDeckListStore.loadCollection(props.eventId)]
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
				label: `${p.name}${deckName ? ` - ${deckName}` : ''}`,
				value: p.id,
			};
		}),
	];
});

// Board selection tabs
const boardTabs: TabsItem[] = [
	{ label: 'Full deck', value: 'full' },
	{ label: 'Mainboard', value: 'mainboard' },
	{ label: 'Sideboard', value: 'sideboard' },
];

// Per-board view tabs
const boardViewTabs: TabsItem[] = [
	{ label: 'Grid', value: 'grid', icon: 'i-lucide-grid-3x3' },
	{ label: 'Stack', value: 'stack', icon: 'i-lucide-layers' },
	{ label: 'List', value: 'list', icon: 'i-lucide-list' },
];

const resolvedBoards = computed(() => resolveDeckBoards(config.value));
const board = computed<BoardSelection>(() => resolvedBoards.value.board);

type BoardKey = 'mainboard' | 'sideboard';

interface BoardSection {
	key: BoardKey;
	title: string;
	layout: ResolvedDeckBoardLayout;
}

const boardSections = computed<BoardSection[]>(() => {
	const sections: BoardSection[] = [];
	if (board.value !== 'sideboard') {
		sections.push({ key: 'mainboard', title: 'Mainboard', layout: resolvedBoards.value.mainboard });
	}
	if (board.value !== 'mainboard') {
		sections.push({ key: 'sideboard', title: 'Sideboard', layout: resolvedBoards.value.sideboard });
	}
	return sections;
});

// The mode-config PATCH replaces a board block wholesale, so every knob change
// writes the complete resolved block back.
function updateBoardLayout(key: BoardKey, patch: Partial<DeckBoardLayoutConfig>) {
	updateConfig({ [key]: { ...resolvedBoards.value[key], ...patch } });
}

// Empty-sideboard hint (#477/#478): the output renders nothing for an empty
// sideboard by design, so the control surface is the place that says so.
const deckCache = usePlayerDeckCache();
const sideboardEmpty = ref(false);
const sideboardLookup = createGuardedSequence();
const selectedPlayerId = computed(() => config.value.deckSource.type === 'player'
	? config.value.deckSource.playerId
	: null);

watch([selectedPlayerId, () => playerStore.players], async ([playerId]) => {
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
				:label="fields.showDeckName.label"
				description="Show the source name and optional secondary label."
				:model-value="config.showDeckName"
				@update:model-value="updateConfig({ showDeckName: $event })"
			/>
			<ScreenSettingsToggle
				:label="fields.showDeckColors.label"
				description="Show the deck's mana colors."
				:model-value="config.showDeckColors"
				@update:model-value="updateConfig({ showDeckColors: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Deck Meta">
			<ScreenSettingsToggle
				:label="fields.showDeckStats.label"
				description="Show card counts by type (creatures, instants, etc.)."
				:model-value="config.showDeckStats"
				@update:model-value="updateConfig({ showDeckStats: $event })"
			/>

			<ScreenSettingsToggle
				v-if="!isBroadcastSource"
				:label="fields.showHighlanderTotal.label"
				description="Show the deck's total 7 Point Highlander points in the deck meta row."
				:model-value="config.showHighlanderTotal"
				@update:model-value="updateConfig({ showHighlanderTotal: $event })"
			/>

			<USeparator />

			<ScreenSettingsToggle
				:label="fields.showDeckMetaPill.label"
				description="Wrap available deck metadata in a single pill."
				:model-value="config.showDeckMetaPill"
				@update:model-value="updateConfig({ showDeckMetaPill: $event })"
			/>

			<template v-if="config.showDeckMetaPill !== false">
				<USeparator />

				<UFormField
					:label="fields.deckMetaPillSize.label"
					description="Size of the deck meta pill."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.deckMetaPillSize"
						:items="QUANTITY_SIZE_SELECT_OPTIONS"
						class="w-32"
						@update:model-value="updateConfig({ deckMetaPillSize: $event })"
					/>
				</UFormField>

				<USeparator />

				<UFormField
					:label="fields.deckMetaPillTextColor.label"
					description="Color of the deck meta text."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.deckMetaPillTextColor"
						placeholder="#111827"
						@update:model-value="updateConfig({ deckMetaPillTextColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.deckMetaPillBgColor.label"
					description="Pick a color or enter any CSS background value."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.deckMetaPillBgColor"
						allow-raw-value
						placeholder="transparent, #ffffff, linear-gradient(...)"
						@update:model-value="updateConfig({ deckMetaPillBgColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.deckMetaPillAccentColor.label"
					description="Color for counts and highlighted values in the pill."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.deckMetaPillAccentColor"
						placeholder="#7c3aed"
						@update:model-value="updateConfig({ deckMetaPillAccentColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.deckMetaPillBorderColor.label"
					description="Border color of the deck meta pill."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.deckMetaPillBorderColor"
						placeholder="#d1d5db"
						@update:model-value="updateConfig({ deckMetaPillBorderColor: $event })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard v-if="!isBroadcastSource" title="Pointed Cards">
			<ScreenSettingsToggle
				:label="fields.showHighlanderPointedCards.label"
				description="Show pointed card chips under the deck info."
				:model-value="config.showHighlanderPointedCards"
				@update:model-value="updateConfig({ showHighlanderPointedCards: $event })"
			/>

			<template v-if="config.showHighlanderPointedCards">
				<USeparator />

				<UFormField
					:label="fields.highlanderPointedCardsSize.label"
					description="Size of the pointed card chips."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.highlanderPointedCardsSize"
						:items="QUANTITY_SIZE_SELECT_OPTIONS"
						class="w-32"
						@update:model-value="updateConfig({ highlanderPointedCardsSize: $event })"
					/>
				</UFormField>

				<USeparator />

				<UFormField
					:label="fields.highlanderPointedCardsTextColor.label"
					description="Color of the pointed card text."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.highlanderPointedCardsTextColor"
						placeholder="#111827"
						@update:model-value="updateConfig({ highlanderPointedCardsTextColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.highlanderPointedCardsBgColor.label"
					description="Background color of the pointed card chips."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.highlanderPointedCardsBgColor"
						placeholder="#ffffff"
						@update:model-value="updateConfig({ highlanderPointedCardsBgColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.highlanderPointedCardsBorderColor.label"
					description="Border color of the pointed card chips."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.highlanderPointedCardsBorderColor"
						placeholder="#d1d5db"
						@update:model-value="updateConfig({ highlanderPointedCardsBorderColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.highlanderPointedCardsAccentColor.label"
					description="Color of the pointed card value."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.highlanderPointedCardsAccentColor"
						placeholder="#7c3aed"
						@update:model-value="updateConfig({ highlanderPointedCardsAccentColor: $event })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Layout">
			<UFormField
				:label="fields.board.label"
				description="Which boards of the deck are shown."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UISegmentedTabs
					:items="boardTabs"
					:model-value="board"
					size="sm"
					@update:model-value="updateConfig({ board: $event as BoardSelection })"
				/>
			</UFormField>

			<p
				v-if="emptyBoardHint"
				data-testid="empty-sideboard-hint"
				class="text-xs text-muted"
			>
				{{ emptyBoardHint }}
			</p>

			<UFormField
				v-if="board === 'full'"
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
		</ScreenSettingsCard>

		<ScreenSettingsCard
			v-for="section in boardSections"
			:key="section.key"
			:title="`${section.title} Layout`"
		>
			<UFormField
				:label="boardFields.view.label"
				:description="`How the ${section.title.toLowerCase()} cards are shown.`"
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UISegmentedTabs
					:items="boardViewTabs"
					:model-value="section.layout.view"
					size="sm"
					@update:model-value="updateBoardLayout(section.key, { view: $event as DeckBoardView })"
				/>
			</UFormField>

			<USeparator />

			<template v-if="section.layout.view === 'grid'">
				<UFormField
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
					description="Space between cards in pixels."
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

				<USeparator />

				<ScreenSettingsToggle
					:label="boardFields.dynamicCardSize.label"
					description="Cards automatically fill the available column width."
					:model-value="section.layout.dynamicCardSize"
					@update:model-value="updateBoardLayout(section.key, { dynamicCardSize: $event })"
				/>

				<UFormField
					v-if="!section.layout.dynamicCardSize"
					:label="boardFields.cardSize.label"
					description="Fixed card size when dynamic sizing is disabled."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="section.layout.cardSize"
						:items="DECK_CARD_SIZE_SELECT_OPTIONS"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { cardSize: $event })"
					/>
				</UFormField>
			</template>

			<template v-else-if="section.layout.view === 'stack'">
				<UFormField
					:label="boardFields.cardSize.label"
					description="Size of the stacked cards."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="section.layout.cardSize"
						:items="DECK_CARD_SIZE_SELECT_OPTIONS"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { cardSize: $event })"
					/>
				</UFormField>

				<UFormField
					:label="boardFields.stackOverlap.label"
					:description="`Percentage of each card visible when stacked (${boardFields.stackOverlap.min}-${boardFields.stackOverlap.max}%).`"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="section.layout.stackOverlap"
						:min="boardFields.stackOverlap.min"
						:max="boardFields.stackOverlap.max"
						:step="boardFields.stackOverlap.step"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { stackOverlap: Number($event) })"
					/>
				</UFormField>
			</template>

			<template v-else>
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
					:label="fields.quantitySize.label"
					description="Size of the quantity badge."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.quantitySize"
						:items="QUANTITY_SIZE_SELECT_OPTIONS"
						class="w-32"
						@update:model-value="updateConfig({ quantitySize: $event })"
					/>
				</UFormField>

				<USeparator />

				<UFormField
					:label="fields.quantityTextColor.label"
					description="Color of the quantity number."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.quantityTextColor"
						placeholder="#ffffff"
						@update:model-value="updateConfig({ quantityTextColor: $event })"
					/>
				</UFormField>

				<UFormField
					:label="fields.quantityBgColor.label"
					description="Background color of the badge."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UIColorPicker
						:model-value="config.quantityBgColor"
						placeholder="#7c3aed"
						@update:model-value="updateConfig({ quantityBgColor: $event })"
					/>
				</UFormField>
			</template>

			<template v-if="!isBroadcastSource">
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
						:label="fields.highlanderPointsSize.label"
						description="Size of the Highlander point badge."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<USelect
							:model-value="config.highlanderPointsSize"
							:items="QUANTITY_SIZE_SELECT_OPTIONS"
							class="w-32"
							@update:model-value="updateConfig({ highlanderPointsSize: $event })"
						/>
					</UFormField>

					<USeparator />

					<UFormField
						:label="fields.highlanderPointsTextColor.label"
						description="Color of the Highlander point number."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UIColorPicker
							:model-value="config.highlanderPointsTextColor"
							placeholder="#ffffff"
							@update:model-value="updateConfig({ highlanderPointsTextColor: $event })"
						/>
					</UFormField>

					<UFormField
						:label="fields.highlanderPointsBgColor.label"
						description="Background color of the Highlander point badge."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UIColorPicker
							:model-value="config.highlanderPointsBgColor"
							placeholder="#7c3aed"
							@update:model-value="updateConfig({ highlanderPointsBgColor: $event })"
						/>
					</UFormField>
				</template>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
