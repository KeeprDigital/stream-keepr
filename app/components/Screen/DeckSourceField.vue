<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { DeckSource } from '~~/shared/screenModeConfigs/deck';
import type { Seat } from '~~/shared/types/enums';
import type { Player } from '~/types';
import { eventKind } from '~~/shared/config/games';
import { PLAYER_SIDE_VALUES, SEAT_VALUES } from '~~/shared/types/enums';
import { featureMatchSidePlayer, seatNumber } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';
import { withFollowedFeatureMatchSession } from '~/utils/featureMatchFollowedSession';

/**
 * The Deck Source picker of Screen settings, an Event Reference (ADR-0038)
 * naming whose Deck List a Screen shows (ADR-0032). Its Event's Card Game
 * decides the sources it offers, a tab each: a Player holding a deck or, where
 * the Event has them on, a Broadcast Deck List; for a One Piece Card Game
 * Event, one Seat of a Feature Match Slot (ADR-0057) or a Player (ADR-0074);
 * for a Commander Event, which has neither Players nor Broadcast Deck Lists,
 * a Seat alone (ADR-0087). Each tab's picker loads what it lists. Opening a tab changes no source;
 * picking emits the whole Deck Source. A source the Screen would show nothing
 * for says so.
 */
const props = defineProps<{
	modelValue: DeckSource;
	eventId: number;
}>();

const emit = defineEmits<{
	'update:modelValue': [deckSource: DeckSource];
}>();

const eventStore = useEventStore();
const playerStore = usePlayerStore();
const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const broadcastDeckListStore = useBroadcastDeckListStore();

const isOpEvent = computed(() => eventStore.event?.game === 'op');
const isCommanderEvent = computed(() => !!eventStore.event && eventKind(eventStore.event) === 'mtg-commander');
const broadcastDeckListsEnabled = computed(() =>
	eventStore.event?.game === 'mtg'
	&& eventStore.event.broadcastDeckListsEnabled,
);

type SourceTab = DeckSource['type'];

const sourceTabs = computed<TabsItem[]>(() => {
	if (isOpEvent.value) {
		return [
			{ label: 'Slot Side', value: 'featureMatchSlot', icon: 'i-lucide-swords' },
			{ label: 'Player', value: 'player', icon: 'i-lucide-user' },
		];
	}
	return broadcastDeckListsEnabled.value
		? [
				{ label: 'Player Deck', value: 'player', icon: 'i-lucide-user' },
				{ label: 'Broadcast Deck List', value: 'broadcast', icon: 'i-lucide-radio' },
			]
		: [];
});

/**
 * The tab a Deck Source shows on, where its Event offers that tab. A One Piece
 * source with no Player picked names neither tab, and the server defaults it
 * to a Slot side.
 */
function sourceTabOf(deckSource: DeckSource): SourceTab | null {
	if (isCommanderEvent.value)
		return 'featureMatchSlot';
	if (isOpEvent.value && deckSource.type === 'player' && deckSource.playerId === null)
		return null;
	return deckSource.type === 'player' || sourceTabs.value.some(tab => tab.value === deckSource.type)
		? deckSource.type
		: null;
}

const firstTab = computed<SourceTab>(() => isOpEvent.value || isCommanderEvent.value
	? 'featureMatchSlot'
	: 'player');
const sourceTab = ref<SourceTab>(sourceTabOf(props.modelValue) ?? firstTab.value);
watch(() => sourceTabOf(props.modelValue), (tab) => {
	if (tab)
		sourceTab.value = tab;
});
// A tab the Event stops offering closes; one it starts offering opens on the source it holds.
watch(() => sourceTabs.value.map(tab => tab.value).join(), () => {
	sourceTab.value = sourceTabOf(props.modelValue) ?? firstTab.value;
});

const selectedPlayerId = computed(() => props.modelValue.type === 'player'
	? props.modelValue.playerId
	: null);
const selectedBroadcastDeckListId = computed(() => props.modelValue.type === 'broadcast'
	? props.modelValue.broadcastDeckListId
	: null);
const slotSide = computed(() => props.modelValue.type === 'featureMatchSlot'
	? props.modelValue
	: null);

/** A Magic: The Gathering Player is offered only with a deck, named with it; its deck name is the proxy for holding one. */
function offerPlayerWithDeck(player: Player) {
	const deckName = getMtgGameData(player.gameData).deckName;
	return deckName
		? `${player.name} - ${deckName}`
		: null;
}

function selectPlayer(playerId: number | null) {
	emit('update:modelValue', { type: 'player', playerId });
}

/** A Broadcast source always names a list, so clearing the picker changes nothing. */
function selectBroadcastDeckList(broadcastDeckListId: number | null) {
	if (broadcastDeckListId !== null)
		emit('update:modelValue', { type: 'broadcast', broadcastDeckListId });
}

const broadcastDeckListItems = computed(() => broadcastDeckListStore.summaries.map(list => ({ label: list.name, value: list.id })));

/** The Seats a Slot of this Event has: a Commander Slot's four, where they sit at the table. */
const sideOptions = computed<{ label: string; value: Seat }[]>(() => isCommanderEvent.value
	? SEAT_VALUES.map(seat => ({ label: `Seat ${seatNumber(seat)}`, value: seat }))
	: PLAYER_SIDE_VALUES.map(seat => ({ label: `Player ${seatNumber(seat)}`, value: seat })));

function selectSlotSide(patch: { slotId?: number | null; side?: Seat }) {
	emit('update:modelValue', {
		type: 'featureMatchSlot',
		slotId: patch.slotId !== undefined
			? patch.slotId
			: slotSide.value?.slotId ?? null,
		side: patch.side ?? slotSide.value?.side ?? 'player1',
	});
}

/** The output shows nothing for a One Piece Player holding no Deck List, so settings say so. */
const emptyPlayerHint = computed(() => {
	const player = playerStore.players.find(candidate => candidate.id === selectedPlayerId.value);
	return !player || getOpGameData(player.gameData).deckList
		? null
		: 'This Player has no Deck List, so the Screen shows nothing. Add one on the Players page.';
});

/** The output shows nothing for a side holding no Deck List, so settings say so. */
const emptySideHint = computed(() => {
	const selected = slotSide.value;
	const slot = selected?.slotId
		? featureMatchStore.featureMatches.find(candidate => candidate.id === selected.slotId)
		: null;
	if (!selected || !slot)
		return null;
	const { data } = featureMatchSidePlayer(withFollowedFeatureMatchSession(slot, featureMatchStateStore), selected.side);
	// A Commander Seat's deck is its Commanders, with or without a list (ADR-0087).
	if (isCommanderEvent.value) {
		return getMtgGameData(data?.gameData).commanders?.length
			? null
			: 'This Seat holds no Commander, so the Screen shows nothing. Pick one in the Slot\'s setup.';
	}
	// A linked side shows its Player's Deck List (ADR-0074).
	const gameData = getOpGameData(data?.gameData);
	return gameData.featureMatchDeckList || gameData.deckList
		? null
		: 'The player on this side has no Deck List, so the Screen shows nothing. Paste one in the Slot\'s setup.';
});

// The Broadcast Deck Lists the picker lists, loaded once the Event offers them.
watch(broadcastDeckListsEnabled, (enabled) => {
	if (enabled && props.eventId)
		void broadcastDeckListStore.loadCollection(props.eventId);
}, { immediate: true });
</script>

<template>
	<UTabs
		v-if="sourceTabs.length > 0"
		v-model="sourceTab"
		:items="sourceTabs"
		:content="false"
		class="mb-5"
	/>

	<template v-if="sourceTab === 'player'">
		<ScreenPlayerField
			data-testid="deck-source-player"
			:model-value="selectedPlayerId"
			:event-id="eventId"
			:description="isOpEvent ? 'The Player whose Deck List to show.' : 'Select a player with a deck list to show.'"
			:offer="isOpEvent ? undefined : offerPlayerWithDeck"
			@update:model-value="selectPlayer"
		/>
		<ScreenSettingsHint v-if="isOpEvent && emptyPlayerHint" data-testid="empty-player-hint">
			{{ emptyPlayerHint }}
		</ScreenSettingsHint>
	</template>

	<template v-else-if="sourceTab === 'broadcast'">
		<ScreenEventReferenceField
			label="Broadcast Deck List"
			description="Choose a list prepared in Event Settings → Broadcast."
			null-label="Select a Broadcast Deck List…"
			:model-value="selectedBroadcastDeckListId"
			:items="broadcastDeckListItems"
			wide
			@update:model-value="selectBroadcastDeckList"
		/>
		<ScreenSettingsHint v-if="broadcastDeckListItems.length === 0">
			No Broadcast Deck Lists are available. Create one in Event Settings → Broadcast.
		</ScreenSettingsHint>
	</template>

	<template v-else>
		<ScreenFeatureMatchSlotField
			data-testid="deck-source-slot"
			:model-value="slotSide?.slotId"
			:event-id="eventId"
			description="The Slot whose Deck List to show."
			@update:model-value="selectSlotSide({ slotId: $event })"
		/>
		<ScreenSettingsField
			:label="isCommanderEvent ? 'Seat' : 'Side'"
			:description="isCommanderEvent
				? 'Shows whoever sits in this Seat now: after Swap Seats, the other player\'s deck.'
				: 'Shows whichever player sits on this side now: after Swap Players, the other player\'s Deck List.'"
		>
			<USelect
				data-testid="deck-source-side"
				:model-value="slotSide?.side ?? 'player1'"
				:items="sideOptions"
				class="w-64"
				@update:model-value="selectSlotSide({ side: $event as Seat })"
			/>
		</ScreenSettingsField>
		<ScreenSettingsHint v-if="emptySideHint" data-testid="empty-side-hint">
			{{ emptySideHint }}
		</ScreenSettingsHint>
	</template>
</template>
