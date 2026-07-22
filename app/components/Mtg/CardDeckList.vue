<script setup lang="ts">
const cardStore = useCardStore();
</script>

<template>
	<div class="min-h-full">
		<!-- Loading State -->
		<UILoadingSpinner v-if="cardStore.loadingDeckList" size="sm" label="Loading deck lists..." />

		<!-- No Selection -->
		<UIEmptyState
			v-else-if="!cardStore.deckListHasData"
			variant="inline"
			icon="i-lucide-layers"
			title="Select a feature match to view deck lists"
		/>

		<!-- Side-by-side columns -->
		<div v-else class="grid min-h-full grid-cols-2 items-start">
			<div class="pr-4 border-r border-default">
				<MtgCardDeckListColumn
					:player-data="cardStore.deckListPlayer1"
					:filter="cardStore.deckListFilter"
				/>
			</div>
			<div class="pl-4">
				<MtgCardDeckListColumn
					:player-data="cardStore.deckListPlayer2"
					:filter="cardStore.deckListFilter"
				/>
			</div>
		</div>
	</div>
</template>
