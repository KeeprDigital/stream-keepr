<script setup lang="ts">
/**
 * The Deck Screen Mode: a One Piece Card Game Deck List from a Feature Match
 * Slot side (ADR-0057), or a Player's or Broadcast Deck List's MTG deck.
 */
const config = useScreenModeConfig('deck');
const showsSlotSide = computed(() => config.value.deckSource.type === 'featureMatchSlot');
</script>

<template>
	<ScreenModesDeckOpDisplay v-if="showsSlotSide" />
	<ScreenModesDeckMtgDisplay v-else />
</template>
