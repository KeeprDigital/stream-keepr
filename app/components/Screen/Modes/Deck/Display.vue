<script setup lang="ts">
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * The Deck List Screen Mode: a One Piece Card Game Deck List from a Feature
 * Match Slot side or a Player (ADR-0057, ADR-0074), or a Player's or Broadcast
 * Deck List's MTG deck. The Card Game previewed or the Event's picks the
 * layout; only One Piece has Slot sides.
 */
const { screen, sampleDataset } = useScreenContext();
const eventStore = useEventStore();
const showsOnePiece = computed(() =>
	(sampleDataset ?? eventStore.displayEvent?.game) === 'op'
	|| resolveScreenModeConfig(screen.value?.modeConfigs, 'deck').deckSource.type === 'featureMatchSlot');
</script>

<template>
	<ScreenModesDeckOpDisplay v-if="showsOnePiece" />
	<ScreenModesDeckMtgDisplay v-else />
</template>
