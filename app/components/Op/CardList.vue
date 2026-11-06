<script lang="ts" setup>
/** One Piece search results, or why there are none. */
const cardStore = useCardStore();
</script>

<template>
	<div class="flex flex-col gap-4">
		<UAlert
			v-if="cardStore.opCardDataAvailable === false"
			color="warning"
			variant="subtle"
			icon="i-lucide-cloud-off"
			title="Card data unavailable"
			description="This installation has no One Piece card data configured. Set NUXT_BANDAI_KEEPR_API_KEY and NUXT_BANDAI_KEEPR_API_URL to search cards."
		/>
		<UAlert
			v-else-if="cardStore.opSearchError"
			color="error"
			variant="subtle"
			icon="i-lucide-triangle-alert"
			:title="cardStore.opSearchError"
		/>
		<p
			v-else-if="cardStore.opSearched && !cardStore.opSearching && !cardStore.opSearchResults.length"
			class="text-sm text-muted"
		>
			No cards match this search.
		</p>
		<div class="op-card-list">
			<div
				v-for="card in cardStore.opSearchResults"
				:key="card.number"
				class="op-card-list-item"
			>
				<OpCardImage
					:card="card"
					selectable
					@selected="cardStore.selectOpCard(card)"
				/>
				<div class="text-center text-sm text-muted tabular-nums">
					{{ card.number }}
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.op-card-list {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
	gap: 1.5rem;
}
</style>
