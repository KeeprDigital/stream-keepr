<script lang="ts" setup>
import type { OpPrintingKind } from '~~/shared/types/card/op';

/** The One Piece Card Controls: the preview, its Printing picker, Show, and the card on screen. */
const cardStore = useCardStore();
const { opPreviewCard, opPreviewPrintings, activeCard, cardsMatch } = storeToRefs(cardStore);

const KIND_LABELS: Record<OpPrintingKind, string> = {
	'standard': 'Standard',
	'alt-art': 'Alt art',
	'reprint': 'Reprint',
};
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
			<template v-if="opPreviewPrintings.length > 1">
				<USeparator label="Printing" />
				<div class="printings" role="group" aria-label="Printing">
					<div
						v-for="printing in opPreviewPrintings"
						:key="printing.id"
						class="flex flex-col gap-1"
					>
						<OpCardImage
							:card="{ name: `${opPreviewCard.name} ${KIND_LABELS[printing.kind]} ${printing.setId}`, imageUrl: printing.imageUrl }"
							selectable
							:selected="printing.id === opPreviewCard.id"
							@selected="cardStore.selectOpPrinting(printing.id)"
						/>
						<span class="text-center text-xs text-muted">
							{{ KIND_LABELS[printing.kind] }} · {{ printing.setId }}
						</span>
					</div>
				</div>
			</template>
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

.printings {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 0.5rem;
}
</style>
