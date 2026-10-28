<script setup lang="ts">
import type { DeckListCardWithData } from '~/types/card/deckList';
import { modeTokenVar } from '~/modules/screen-mode';

const props = defineProps<{
	card: DeckListCardWithData;
	/** Its width while its sizing is fixed: its board's card width. */
	width?: string;
	showQuantity: boolean;
	showHighlanderPoints: boolean;
	quantityPositionClass: string;
	quantityBadgeStyle: Record<string, string>;
	highlanderPointsPositionClass: string;
	highlanderPointsBadgeStyle: Record<string, string>;
	/** Fixed takes `width`; fill takes its column; fit fits its grid cell both ways. */
	sizing: 'fixed' | 'fill' | 'fit';
}>();

const cardStyle = computed(() => {
	switch (props.sizing) {
		case 'fixed': return { width: props.width };
		case 'fill': return { width: '100%' };
		default: return {};
	}
});

/** A fitted card sits in a box that fits it to its grid cell. */
const cardBox = computed(() => props.sizing === 'fit'
	? resolveComponent('MtgCardFitBox')
	: 'div');

const placeholderStyle = {
	backgroundColor: modeTokenVar('deck', 'card-placeholder'),
};

function getCardImageUrl(card: DeckListCardWithData): string | null {
	return card.mtgCard?.imageData?.front?.normal ?? null;
}
</script>

<template>
	<component :is="cardBox" class="min-w-0 min-h-0" :data-sizing="sizing">
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
				class="absolute rounded-md font-bold tabular-nums leading-none"
				:class="highlanderPointsPositionClass"
				:style="highlanderPointsBadgeStyle"
			>
				{{ card.highlanderPoints }}
			</div>
			<div
				v-if="showQuantity && card.quantity > 1"
				class="quantity-badge absolute font-bold rounded-full flex items-center justify-center"
				:class="quantityPositionClass"
				:style="quantityBadgeStyle"
			>
				{{ card.quantity }}
			</div>
		</div>
	</component>
</template>
