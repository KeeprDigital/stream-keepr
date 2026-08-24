<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { BoardSelection, DeckBoardView, SideboardPlacement } from '~~/shared/types/enums';
import type { DeckBoardLayoutConfig, ResolvedDeckBoardLayout } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { resolveDeckBoards } from '~~/shared/types/screenConfig';
import { getMtgGameData } from '~~/shared/utils/gameData';
import {
	DECK_CARD_SIZE_SELECT_OPTIONS,
	QUANTITY_POSITION_SELECT_OPTIONS,
	QUANTITY_SIZE_SELECT_OPTIONS,
	SIDEBOARD_PLACEMENT_SELECT_OPTIONS,
} from '~~/shared/utils/selectOptions';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const playerStore = usePlayerStore();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'deck',
);

defineExpose({ resetConfig, saving });

// Load players on mount
onMounted(async () => {
	if (props.eventId) {
		await playerStore.loadPlayersByEventId(props.eventId);
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

watch([() => config.value.playerId, () => playerStore.players], async ([playerId]) => {
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

const showEmptySideboardHint = computed(() => board.value !== 'mainboard' && sideboardEmpty.value);
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Deck Source">
			<UFormField
				label="Player"
				description="Select a player with a deck list to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.playerId"
					:items="playerOptions"
					class="w-64"
					@update:model-value="updateConfig({ playerId: $event })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				label="Show Deck Name"
				description="Show player name and deck name header."
				:model-value="config.showDeckName"
				@update:model-value="updateConfig({ showDeckName: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Deck Colors"
				description="Show the deck's mana colors."
				:model-value="config.showDeckColors"
				@update:model-value="updateConfig({ showDeckColors: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Deck Meta">
			<ScreenSettingsToggle
				label="Show Deck Stats"
				description="Show card counts by type (creatures, instants, etc.)."
				:model-value="config.showDeckStats"
				@update:model-value="updateConfig({ showDeckStats: $event })"
			/>

			<ScreenSettingsToggle
				label="Show Total Points"
				description="Show the deck's total 7 Point Highlander points in the deck meta row."
				:model-value="config.showHighlanderTotal"
				@update:model-value="updateConfig({ showHighlanderTotal: $event })"
			/>

			<USeparator />

			<ScreenSettingsToggle
				label="Show Deck Meta Pill"
				description="Wrap companion, total points, and deck stats in a single pill."
				:model-value="config.showDeckMetaPill"
				@update:model-value="updateConfig({ showDeckMetaPill: $event })"
			/>

			<template v-if="config.showDeckMetaPill !== false">
				<USeparator />

				<UFormField
					label="Pill Size"
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
					label="Text Color"
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
					label="Background"
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
					label="Accent Color"
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
					label="Border Color"
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

		<ScreenSettingsCard title="Pointed Cards">
			<ScreenSettingsToggle
				label="Show Pointed Cards"
				description="Show pointed card chips under the deck info."
				:model-value="config.showHighlanderPointedCards"
				@update:model-value="updateConfig({ showHighlanderPointedCards: $event })"
			/>

			<template v-if="config.showHighlanderPointedCards">
				<USeparator />

				<UFormField
					label="Chip Size"
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
					label="Text Color"
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
					label="Background Color"
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
					label="Border Color"
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
					label="Accent Color"
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
				label="Boards"
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
				v-if="showEmptySideboardHint"
				data-testid="empty-sideboard-hint"
				class="text-xs text-muted"
			>
				This player's deck has no sideboard cards, so the output shows nothing for the sideboard.
			</p>

			<UFormField
				v-if="board === 'full'"
				label="Sideboard Placement"
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
				label="View"
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
					label="Grid Columns"
					description="Number of columns in the card grid."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="section.layout.columns"
						:min="1"
						:max="12"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { columns: Number($event) })"
					/>
				</UFormField>

				<UFormField
					label="Card Gap"
					description="Space between cards in pixels."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="section.layout.cardGap"
						:min="0"
						:max="48"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { cardGap: Number($event) })"
					/>
				</UFormField>

				<USeparator />

				<ScreenSettingsToggle
					label="Dynamic Card Size"
					description="Cards automatically fill the available column width."
					:model-value="section.layout.dynamicCardSize"
					@update:model-value="updateBoardLayout(section.key, { dynamicCardSize: $event })"
				/>

				<UFormField
					v-if="!section.layout.dynamicCardSize"
					label="Card Size"
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
					label="Card Size"
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
					label="Stack Visible %"
					description="Percentage of each card visible when stacked (5-50%)."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="section.layout.stackOverlap"
						:min="5"
						:max="50"
						:step="1"
						class="w-32"
						@update:model-value="updateBoardLayout(section.key, { stackOverlap: Number($event) })"
					/>
				</UFormField>
			</template>

			<template v-else>
				<UFormField
					label="List Columns"
					description="Number of columns in the list."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="section.layout.listColumns"
						:min="1"
						:max="4"
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
				label="Show Quantities"
				description="Show quantity badges on cards with multiple copies."
				:model-value="config.showQuantities"
				@update:model-value="updateConfig({ showQuantities: $event })"
			/>

			<template v-if="config.showQuantities">
				<USeparator />

				<UFormField
					label="Badge Position"
					description="Where the badge appears on the card."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.quantityPosition"
						:items="QUANTITY_POSITION_SELECT_OPTIONS"
						class="w-40"
						@update:model-value="updateConfig({ quantityPosition: $event })"
					/>
				</UFormField>

				<UFormField
					label="Badge Size"
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
					label="Text Color"
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
					label="Background Color"
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

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Highlander Point Badges
			</p>

			<ScreenSettingsToggle
				label="Show Point Badges"
				description="Show 7 Point Highlander point badges on pointed cards."
				:model-value="config.showHighlanderPoints"
				@update:model-value="updateConfig({ showHighlanderPoints: $event })"
			/>

			<template v-if="config.showHighlanderPoints">
				<USeparator />

				<UFormField
					label="Badge Position"
					description="Where the point badge appears on the card in grid mode."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.highlanderPointsPosition"
						:items="QUANTITY_POSITION_SELECT_OPTIONS"
						class="w-40"
						@update:model-value="updateConfig({ highlanderPointsPosition: $event })"
					/>
				</UFormField>

				<UFormField
					label="Badge Size"
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
					label="Text Color"
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
					label="Background Color"
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
		</ScreenSettingsCard>
	</div>
</template>
