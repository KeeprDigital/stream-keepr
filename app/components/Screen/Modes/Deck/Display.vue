<script setup lang="ts">
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * The Deck Screen Mode: a One Piece Card Game Deck List from a Feature Match
 * Slot side (ADR-0057), or a Player's or Broadcast Deck List's MTG deck.
 */
const { screen } = useScreenContext();
const showsSlotSide = computed(() =>
	resolveScreenModeConfig(screen.value?.modeConfigs, 'deck').deckSource.type === 'featureMatchSlot');
</script>

<template>
	<ScreenModesDeckOpDisplay v-if="showsSlotSide" />
	<ScreenModesDeckMtgDisplay v-else />
</template>
