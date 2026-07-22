<script setup lang="ts">
const cardStore = useCardStore();
</script>

<template>
	<div class="min-h-full">
		<!-- Loading State -->
		<UILoadingSpinner v-if="cardStore.loadingPlayerDeck" size="sm" label="Loading deck list..." />

		<!-- No Selection -->
		<UIEmptyState
			v-else-if="!cardStore.playerDeckHasData"
			variant="inline"
			icon="i-lucide-user"
			title="Select a player to view their deck list"
		/>

		<!-- Full-width single column -->
		<div v-else>
			<MtgCardDeckListColumn
				:player-data="cardStore.playerDeckData"
				:filter="cardStore.deckListFilter"
			/>
		</div>
	</div>
</template>
