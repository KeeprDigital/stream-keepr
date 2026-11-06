<script lang="ts" setup>
import { LazyOpCardPrinting } from '#components';

/** The One Piece Card Controls: the preview, Show, Switch Printing, and the card on screen. */
const cardStore = useCardStore();
const { opPreviewCard, opPreviewPrintings, activeCard, cardsMatch } = storeToRefs(cardStore);

const printingModal = useOverlay().create(LazyOpCardPrinting);

function openPrintList() {
	void printingModal.open({});
}
</script>

<template>
	<div class="op-card-controls">
		<div v-if="opPreviewCard" class="flex flex-col gap-2">
			<h1 class="text-center font-medium">
				{{ opPreviewCard.name }}
			</h1>
			<OpCardImage :key="opPreviewCard.id" :card="opPreviewCard" />
			<CardShowControl
				:replacing="!!activeCard"
				:matches="cardsMatch"
				@show="cardStore.showOpPreviewCard()"
			/>
			<UButton
				v-if="opPreviewPrintings.length > 1"
				variant="outline"
				color="neutral"
				icon="i-lucide-printer"
				block
				@click="openPrintList"
			>
				Switch Printing
			</UButton>
		</div>
		<MtgCardControlsActive class="mt-auto" />
	</div>
</template>

<style scoped>
.op-card-controls {
	height: 100%;
	display: flex;
	flex-direction: column;
	padding: 0.5rem;
	gap: 0.5rem;
	overflow-y: auto;
}
</style>
