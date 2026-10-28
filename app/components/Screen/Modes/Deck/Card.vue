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
	/** A tag naming the card's role, such as the companion's. */
	tag?: string;
	/** Where the tag sits, as the other badges are placed. */
	tagPositionClass?: string;
}>();

/** A pill matching the quantity badge: its colours, its text size and its 1.75em height. */
const tagStyle = computed(() => ({
	fontSize: props.quantityBadgeStyle.fontSize ?? '16px',
	height: '1.75em',
	padding: '0 0.75em',
	color: modeTokenVar('deck', 'quantity-badge-text'),
	backgroundColor: modeTokenVar('deck', 'quantity-badge-surface'),
}));

// A Fit grid's columns are already card-sized, so a fitted card fills its column.
const cardStyle = computed(() => props.sizing === 'fixed'
	? { width: props.width }
	: { width: '100%' });

const placeholderStyle = {
	backgroundColor: modeTokenVar('deck', 'card-placeholder'),
};

function getCardImageUrl(card: DeckListCardWithData): string | null {
	return card.mtgCard?.imageData?.front?.normal ?? null;
}
</script>

<template>
	<div class="min-w-0 min-h-0" :data-sizing="sizing">
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
			<div
				v-if="tag"
				data-testid="deck-card-tag"
				class="absolute rounded-full font-bold uppercase tracking-wide leading-none whitespace-nowrap flex items-center"
				:class="tagPositionClass ?? '-top-1 left-1/2 -translate-x-1/2'"
				:style="tagStyle"
			>
				{{ tag }}
			</div>
		</div>
	</div>
</template>
