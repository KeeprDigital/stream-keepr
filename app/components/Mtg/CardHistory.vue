<script lang="ts" setup>
import type { MtgCard } from '~/types/card/mtg';

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const cardStore = useCardStore();

function selectCard(card: MtgCard) {
	void cardStore.selectPreviewCard(card, card.displayData.turnedOver);
	emit('close');
}

function clearHistory() {
	cardStore.clearHistory();
	emit('close');
}
</script>

<template>
	<UModal
		title="History"
		:ui="{
			content: 'sm:max-w-screen-xl',
		}"
		description="Select a card from your history to preview it"
	>
		<template #body>
			<div class="card-list">
				<div
					v-for="(card, index) in cardStore.selectionHistory"
					:key="index"
					class="card-list-item"
				>
					<MtgCardImage
						class="card-list-item-image"
						:card="card"
						:display="card.displayData"
						display-mode="history"
						@selected="selectCard(card)"
					/>
					<div class="card-list-item-title">
						{{ card.name }}
					</div>
				</div>
				<div class="card-list-item" />
				<div class="card-list-item" />
				<div class="card-list-item" />
				<div class="card-list-item" />
			</div>
		</template>
		<template #footer>
			<UButton @click="clearHistory">
				Clear
			</UButton>
		</template>
	</UModal>
</template>

<style scoped>
.card-list {
	display: flex;
	flex-flow: row wrap;
	justify-content: space-between;
	row-gap: 0.75rem;

	.card-list-item {
		width: 19%;

		.card-list-item-title {
			text-align: center;
			font-size: 1rem;
		}
	}
}
</style>
