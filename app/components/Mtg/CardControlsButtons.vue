<script lang="ts" setup>
import type { MtgPreviewCardAction } from '~/types/card/mtg';
import { LazyMtgCardPrinting } from '#components';

const cardStore = useCardStore();

const {
	selectMeldCardPart,
} = cardStore;

const {
	previewCard,
	previewCardPrintings,
	activeCard,
	cardsMatch,
} = storeToRefs(cardStore);

const modal = useOverlay().create(LazyMtgCardPrinting);

function openPrintList() {
	void modal.open({});
}

const hasOrientationControls = computed(() =>
	previewCard.value?.orientationData.turnable
	|| previewCard.value?.orientationData.rotateable
	|| previewCard.value?.orientationData.counterRotateable
	|| previewCard.value?.orientationData.flipable,
);

function cardAction(action: MtgPreviewCardAction) {
	void cardStore.controlPreviewCard(action);
}
</script>

<template>
	<div v-if="previewCard" class="flex flex-col gap-2">
		<!-- Primary CTA: Show / Replace -->
		<CardShowControl
			:replacing="!!activeCard"
			:matches="cardsMatch"
			@show="cardAction('show')"
		/>

		<!-- Meld controls -->
		<USeparator v-if="previewCard.meldData" />
		<UFieldGroup v-if="previewCard.meldData" orientation="horizontal">
			<UButton
				v-if="previewCard.meldData?.meldPartOne"
				variant="outline"
				color="info"
				block
				:disabled="previewCard.name === previewCard.meldData?.meldPartOne"
				@click="selectMeldCardPart(previewCard.meldData?.meldPartOne)"
			>
				{{ previewCard.meldData?.meldPartOne }}
			</UButton>
			<UButton
				v-if="previewCard.meldData?.meldPartTwo"
				variant="outline"
				color="info"
				block
				:disabled="previewCard.name === previewCard.meldData?.meldPartTwo"
				@click="selectMeldCardPart(previewCard.meldData?.meldPartTwo)"
			>
				{{ previewCard.meldData?.meldPartTwo }}
			</UButton>
		</UFieldGroup>
		<UButton
			v-if="previewCard.meldData?.meldResult"
			variant="outline"
			color="info"
			block
			icon="i-lucide-flip-horizontal"
			:disabled="previewCard.name === previewCard.meldData?.meldResult"
			@click="selectMeldCardPart(previewCard.meldData?.meldResult)"
		>
			{{ previewCard.meldData?.meldResult }}
		</UButton>

		<!-- Orientation controls -->
		<USeparator v-if="hasOrientationControls" />
		<UButton
			v-if="previewCard.orientationData.turnable"
			variant="outline"
			color="neutral"
			icon="i-lucide-flip-horizontal"
			block
			@click="cardAction('turnOver')"
		>
			Turn Over
		</UButton>
		<UButton
			v-if="previewCard.orientationData.rotateable"
			variant="outline"
			color="neutral"
			icon="i-lucide-rotate-cw"
			block
			@click="cardAction('rotate')"
		>
			Rotate Clockwise
		</UButton>
		<UButton
			v-if="previewCard.orientationData.counterRotateable"
			variant="outline"
			color="neutral"
			icon="i-lucide-rotate-ccw"
			block
			@click="cardAction('counterRotate')"
		>
			Rotate Counter-Clockwise
		</UButton>
		<UButton
			v-if="previewCard.orientationData.flipable"
			:ui="{
				leadingIcon: 'rotate-90',
			}"
			variant="outline"
			color="neutral"
			icon="i-lucide-rotate-cw"
			block
			@click="cardAction('flip')"
		>
			Flip
		</UButton>

		<!-- Switch Printing -->
		<UButton
			v-if="previewCardPrintings.length > 1"
			variant="outline"
			color="neutral"
			icon="i-lucide-printer"
			block
			@click="openPrintList"
		>
			Switch Printing
		</UButton>
	</div>
</template>
