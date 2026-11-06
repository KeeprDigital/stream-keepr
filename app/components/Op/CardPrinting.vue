<script lang="ts" setup>
import type { OpPrintingKind } from '~~/shared/types/card/op';

/** The previewed One Piece card's Printings, as Magic: The Gathering's: choosing one previews it and closes. */
const emit = defineEmits<{
	(e: 'close'): void;
}>();

const cardStore = useCardStore();
const { opPreviewCard, opPreviewPrintings } = storeToRefs(cardStore);

const KIND_LABELS: Record<OpPrintingKind, string> = {
	'standard': 'Standard',
	'alt-art': 'Alt art',
	'reprint': 'Reprint',
};

function select(printingId: string) {
	cardStore.selectOpPrinting(printingId);
	emit('close');
}
</script>

<template>
	<UModal
		:title="opPreviewCard?.name ?? ''"
		description="Alternative printings"
		:ui="{
			content: 'sm:max-w-screen-xl',
		}"
	>
		<template #body>
			<div class="card-list" role="group" aria-label="Printing">
				<div
					v-for="printing in opPreviewPrintings"
					:key="printing.id"
					class="card-list-item"
				>
					<OpCardImage
						:card="{ name: `${opPreviewCard?.name} ${KIND_LABELS[printing.kind]} ${printing.setId}`, imageUrl: printing.imageUrl }"
						selectable
						:selected="printing.id === opPreviewCard?.id"
						@selected="select(printing.id)"
					/>
					<div class="card-list-item-title">
						{{ KIND_LABELS[printing.kind] }} · {{ printing.setId }}
					</div>
				</div>
				<div class="card-list-item" />
				<div class="card-list-item" />
				<div class="card-list-item" />
				<div class="card-list-item" />
			</div>
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
