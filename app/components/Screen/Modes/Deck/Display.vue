<script setup lang="ts">
import { eventKind } from '~~/shared/config/games';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * The Deck List Screen Mode: a One Piece Card Game Deck List from a Feature
 * Match Slot Seat or a Player (ADR-0057, ADR-0074), or a Magic: The Gathering
 * deck: a Player's, a Broadcast Deck List's, or a Commander Seat's (ADR-0087).
 * The Card Game previewed or the Event's picks the layout. A Seat is a Deck
 * Source on a One Piece Card Game Event and a Commander Event alone.
 */
const { screen, sampleDataset } = useScreenContext();
const eventStore = useEventStore();
const followsSlot = computed(() =>
	resolveScreenModeConfig(screen.value?.modeConfigs, 'deck').deckSource.type === 'featureMatchSlot');
const showsCommanderSeat = computed(() => {
	const event = eventStore.displayEvent;
	return !sampleDataset && followsSlot.value && !!event && eventKind(event) === 'mtg-commander';
});
const showsOnePiece = computed(() => !showsCommanderSeat.value
	&& ((sampleDataset ?? eventStore.displayEvent?.game) === 'op' || followsSlot.value));
</script>

<template>
	<ScreenModesDeckOpDisplay v-if="showsOnePiece" />
	<!-- Keyed, so a display set up to follow a Seat is never reused for another source. -->
	<ScreenModesDeckMtgDisplay v-else :key="showsCommanderSeat ? 'seat' : 'deck'" :follows-seat="showsCommanderSeat" />
</template>
