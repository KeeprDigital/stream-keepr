<script setup lang="ts">
import type { InputMenuItem, TabsItem } from '@nuxt/ui';
import type { PlayerSide } from '~~/shared/types/enums';
import type { DeckModeConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { eventCanvasOf } from '~~/shared/eventCanvas';
import { DECK_MAINBOARD_LAYOUT_FIELDS, patchedBoardLayout } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getOpGameData } from '~~/shared/utils/gameData';
import { playerLabel, playerMatchesSearch } from '~~/shared/utils/playerName';
import { cardLayoutSummary, FOLLOWS_THE_THEME, lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { withFollowedFeatureMatchSession } from '~/utils/featureMatchFollowedSession';

/**
 * A One Piece Card Game Event's Deck List Screen settings: its Deck Source is
 * one player side of a Feature Match Slot (ADR-0057) or a Player (ADR-0074),
 * and its Deck List has a Leader and a Mainboard only, so no Sideboard,
 * Companion or points.
 */
const props = defineProps<{
	screen: Screen;
	config: DeckModeConfig;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [patch: Partial<DeckModeConfig>];
}>();

const eventStore = useEventStore();
const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const playerStore = usePlayerStore();

const fields = screenModeConfigContract('deck').fields;
const layoutFields = DECK_MAINBOARD_LAYOUT_FIELDS;

const sideOptions: { label: string; value: PlayerSide }[] = [
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
];

type SourceTab = 'featureMatchSlot' | 'player';

/**
 * The tab a Deck Source shows on: a Player picked on the Player tab, a Slot
 * side on its own; no Player picked names neither, and the server defaults it
 * to a Slot side. Opening a tab changes no source.
 */
function sourceTabOf(deckSource: DeckModeConfig['deckSource']): SourceTab | null {
	if (deckSource.type === 'featureMatchSlot')
		return 'featureMatchSlot';
	return deckSource.type === 'player' && deckSource.playerId !== null
		? 'player'
		: null;
}
const sourceTab = ref<SourceTab>(sourceTabOf(props.config.deckSource) ?? 'featureMatchSlot');
watch(() => sourceTabOf(props.config.deckSource), (tab) => {
	if (tab)
		sourceTab.value = tab;
});
const sourceTabs: TabsItem[] = [
	{ label: 'Slot Side', value: 'featureMatchSlot', icon: 'i-lucide-swords' },
	{ label: 'Player', value: 'player', icon: 'i-lucide-user' },
];

const source = computed(() => props.config.deckSource.type === 'featureMatchSlot'
	? props.config.deckSource
	: null);

const selectedPlayerId = computed(() => props.config.deckSource.type === 'player'
	? props.config.deckSource.playerId
	: null);

// The picker finds a Player by name, Nickname or Bandai member number (ADR-0074).
const playerSearch = ref('');
const playerItems = computed<(InputMenuItem & { id: number })[]>(() => playerStore.players
	.filter(player => playerMatchesSearch(player, playerSearch.value))
	.map(player => ({
		label: playerLabel(player),
		id: player.id,
	})));

function selectPlayer(playerId: number | null) {
	emit('update', {
		deckSource: { type: 'player', playerId },
	});
}

/** The output shows nothing for a Player holding no Deck List, so settings say so. */
const emptyPlayerHint = computed(() => {
	const player = playerStore.players.find(candidate => candidate.id === selectedPlayerId.value);
	return !player || getOpGameData(player.gameData).deckList
		? null
		: 'This Player has no Deck List, so the Screen shows nothing. Add one on the Players page.';
});

function selectSource(patch: { slotId?: number | null; side?: PlayerSide }) {
	emit('update', {
		deckSource: {
			type: 'featureMatchSlot',
			slotId: patch.slotId !== undefined
				? patch.slotId
				: source.value?.slotId ?? null,
			side: patch.side ?? source.value?.side ?? 'player1',
		},
	});
}

/** The output shows nothing for a side holding no Deck List, so settings say so. */
const emptySideHint = computed(() => {
	const selected = source.value;
	const slot = selected?.slotId
		? featureMatchStore.featureMatches.find(candidate => candidate.id === selected.slotId)
		: null;
	if (!selected || !slot)
		return null;
	const { data } = featureMatchSidePlayer(withFollowedFeatureMatchSession(slot, featureMatchStateStore), selected.side);
	// A linked side shows its Player's Deck List (ADR-0074).
	const gameData = getOpGameData(data?.gameData);
	return gameData.featureMatchDeckList || gameData.deckList
		? null
		: 'The player on this side has no Deck List, so the Screen shows nothing. Paste one in the Slot\'s setup.';
});

const layout = computed(() => resolveDeckBoards(props.config).mainboard);

/** The Event Canvas the Screen renders in, which bounds the max card size. */
const eventCanvas = computed(() => eventCanvasOf(eventStore.event));

// The mode-config PATCH replaces a board block wholesale, an Auto value as its absent key.
function updateLayout(patch: Parameters<typeof patchedBoardLayout>[1]) {
	emit('update', {
		mainboard: patchedBoardLayout(layout.value, patch),
	});
}

const layoutDescriptions = {
	alignment: 'Where the groups sit when they don\'t fill their space.',
	columns: 'Cards per row of every group. Empty is Auto: the count that fits the cards largest.',
};

/** For a closed card's summary: how many Screen Theme Overrides the Looks of mounted `groups` hold. */
function look(...groups: string[]) {
	return lookSummary('deck', props.screen.themeOverrides, groups);
}

const headerCardSummary = computed(() => settingsSummary([
	[
		props.config.showPlayerName !== false && 'Player name',
		props.config.showDeckName !== false && 'Leader',
		props.config.showDeckColors !== false && 'colours',
	].filter(Boolean).join(', ') || 'Nothing shown',
]));
const detailsSummary = computed(() => settingsSummary([
	look('deck-details', 'pointed-cards'),
], FOLLOWS_THE_THEME));
const mainboardSummary = computed(() => settingsSummary([
	cardLayoutSummary(layout.value),
	props.config.showCostCurve !== false && 'Cost curve',
]));
const badgesSummary = computed(() => settingsSummary([
	props.config.showQuantities
		? 'Quantity badge'
		: 'No badges',
	look('quantity-badge', 'points-badge'),
]));

// What the pickers load, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots', 'players']);

onMounted(async () => {
	if (props.eventId) {
		await Promise.allSettled([
			featureMatchStore.loadFeatureMatchesByEventId(props.eventId),
			playerStore.loadPlayersByEventId(props.eventId),
		]);
	}
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="deck:deck-source" title="Deck Source" :collapsible="false">
			<UTabs v-model="sourceTab" :items="sourceTabs" :content="false" />

			<template v-if="sourceTab === 'player'">
				<ScreenSettingsField label="Player" description="The Player whose Deck List to show." class="mt-5">
					<UInputMenu
						v-model:search-term="playerSearch"
						data-testid="deck-source-player"
						:model-value="selectedPlayerId ?? undefined"
						:items="playerItems"
						ignore-filter
						value-key="id"
						icon="i-lucide-user-search"
						placeholder="Select a player…"
						class="w-64"
						@update:model-value="selectPlayer($event ?? null)"
					/>
				</ScreenSettingsField>
				<p v-if="emptyPlayerHint" data-testid="empty-player-hint" class="text-xs text-muted">
					{{ emptyPlayerHint }}
				</p>
			</template>

			<template v-else>
				<ScreenSettingsField label="Feature Match Slot" description="The Slot whose Deck List to show." class="mt-5">
					<ScreenFeatureMatchSelect
						data-testid="deck-source-slot"
						:model-value="source?.slotId"
						placeholder="Select a slot…"
						@update:model-value="selectSource({ slotId: $event })"
					/>
				</ScreenSettingsField>
				<ScreenSettingsField
					label="Side"
					description="Shows whichever player sits on this side now: after Swap Players, the other player's Deck List."
				>
					<USelect
						data-testid="deck-source-side"
						:model-value="source?.side ?? 'player1'"
						:items="sideOptions"
						class="w-64"
						@update:model-value="selectSource({ side: $event as PlayerSide })"
					/>
				</ScreenSettingsField>
				<p v-if="emptySideHint" data-testid="empty-side-hint" class="text-xs text-muted">
					{{ emptySideHint }}
				</p>
			</template>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="deck:header" title="Header" :summary="headerCardSummary">
			<ScreenConfigField
				:field="fields.showPlayerName"
				:model-value="config.showPlayerName !== false"
				description="The player's name, on the first line."
				@update:model-value="emit('update', { showPlayerName: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showDeckName"
				:model-value="config.showDeckName !== false"
				description="The Leader's name, which names the deck."
				@update:model-value="emit('update', { showDeckName: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showDeckColors"
				:model-value="config.showDeckColors !== false"
				description="The Leader's colours, beside its name."
				@update:model-value="emit('update', { showDeckColors: $event === true })"
			/>
		</ScreenSettingsSection>

		<!-- No One Piece control sits in these groups, but their Mode Tokens are the Deck List's, so their Looks are here. -->
		<ScreenSettingsSection
			id="deck:deck-details"
			title="Deck Details"
			subtitle="The cost curve's bars take the accent; the rest styles a Magic Deck List's details row."
			:summary="detailsSummary"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="deck-details" />
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="pointed-cards" />
		</ScreenSettingsSection>

		<ScreenSettingsSection id="deck:mainboard" title="Mainboard" :summary="mainboardSummary">
			<ScreenSettingsHint>
				Grouped Character, Event, Stage, each by cost, beside the Leader.
			</ScreenSettingsHint>

			<ScreenConfigField
				:field="fields.showCostCurve"
				:model-value="config.showCostCurve !== false"
				description="Cards by cost, under the Leader."
				@update:model-value="emit('update', { showCostCurve: $event === true })"
			/>

			<USeparator />

			<ScreenCardGridLayoutFields
				:layout="layout"
				:fields="layoutFields"
				:canvas="eventCanvas"
				:show="{ alignment: true }"
				:descriptions="layoutDescriptions"
				grid-name="Mainboard"
				@update="updateLayout($event)"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="deck:card-badges" title="Card Badges" :summary="badgesSummary">
			<ScreenCardBadgeFields
				title="Quantity Badge"
				:shown="!!config.showQuantities"
				:shown-field="fields.showQuantities"
				shown-description="Show quantity badges on cards with multiple copies."
				:position="config.quantityPosition ?? DEFAULT_QUANTITY_POSITION"
				:position-field="fields.quantityPosition"
				:text-size="config.quantityBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.quantityBadgeSize"
				:size-field="fields.quantityBadgeSize"
				@update="emit('update', $event)"
			>
				<template #look>
					<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="quantity-badge" />
				</template>
			</ScreenCardBadgeFields>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="points-badge" />
		</ScreenSettingsSection>
	</div>
</template>
