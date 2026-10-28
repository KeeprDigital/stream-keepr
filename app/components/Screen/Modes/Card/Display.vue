<script setup lang="ts">
const { config, screenId, card, error, ready } = useCardModeData();

/** The card's width is the Screen's own config, in Event Canvas px (ADR-0054). */
const cardWidth = computed(() => `${config.value.cardWidth}px`);
</script>

<template>
	<ScreenModeBase
		:error="error"
		:ready="ready"
		:empty="!screenId"
	>
		<MtgCardDisplay
			v-if="screenId"
			:card="card"
			:width="cardWidth"
		/>
	</ScreenModeBase>
</template>
