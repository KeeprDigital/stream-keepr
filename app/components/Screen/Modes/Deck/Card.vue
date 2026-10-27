<script setup lang="ts">
import type { DeckListCardWithData } from '~/types/card/deckList';
import { modeTokenVar } from '~/modules/screen-mode';

const props = defineProps<{
	card: DeckListCardWithData;
	showQuantity: boolean;
	showHighlanderPoints: boolean;
	quantityPositionClass: string;
	quantitySizeClass: string;
	quantityBadgeStyle: Record<string, string>;
	highlanderPointsPositionClass: string;
	highlanderPointsSizeClass: string;
	highlanderPointsBadgeStyle: Record<string, string>;
	/** Fills its grid column rather than taking the `card-width` Mode Token. */
	dynamicSize?: boolean;
}>();

const cardStyle = computed(() => props.dynamicSize
	? {}
	: {
			width: modeTokenVar('deck', 'card-width'),
		});

const placeholderStyle = {
	backgroundColor: modeTokenVar('deck', 'card-placeholder'),
};

function getCardImageUrl(card: DeckListCardWithData): string | null {
	return card.mtgCard?.imageData?.front?.normal ?? null;
}
</script>

<template>
	<div
		class="card-item relative"
		:style="cardStyle"
	>
		<div class="mtg-card" :style="placeholderStyle">
			<NuxtImg
				v-if="getCardImageUrl(card)"
				:src="getCardImageUrl(card)!"
				:alt="card.name"
				width="488"
				height="680"
				class="w-full h-full object-cover"
				loading="eager"
			/>
			<div v-else class="w-full h-full flex items-center justify-center text-xs text-center p-1">
				{{ card.name }}
			</div>
		</div>
		<div
			v-if="showHighlanderPoints && card.highlanderPoints != null"
			data-testid="highlander-card-badge"
			class="absolute rounded-md font-mono font-bold leading-none shadow-md"
			:class="[highlanderPointsPositionClass, highlanderPointsSizeClass]"
			:style="highlanderPointsBadgeStyle"
		>
			{{ card.highlanderPoints }}
		</div>
		<div
			v-if="showQuantity && card.quantity > 1"
			class="quantity-badge absolute font-bold rounded-full flex items-center justify-center"
			:class="[quantityPositionClass, quantitySizeClass]"
			:style="quantityBadgeStyle"
		>
			{{ card.quantity }}
		</div>
	</div>
</template>
