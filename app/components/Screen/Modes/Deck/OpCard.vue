<script setup lang="ts">
import type { OpDeckCard } from '~~/shared/utils/opDeckLayout';
import { modeTokenVar } from '~/modules/screen-mode';

/** One One Piece Card Game card of a Deck Screen, as printed, with its quantity badge. */
const props = defineProps<{
	card: OpDeckCard;
	/** Its width while its sizing is fixed. */
	width?: string;
	/** Fixed takes `width`; fit fills its grid cell. */
	sizing: 'fixed' | 'fit';
	showQuantity: boolean;
	quantityPositionClass: string;
	quantityBadgeStyle: Record<string, string>;
}>();

const cardStyle = computed(() => props.sizing === 'fixed'
	? { width: props.width }
	: { width: '100%' });

const placeholderStyle = {
	backgroundColor: modeTokenVar('deck', 'card-placeholder'),
};
</script>

<template>
	<div
		class="min-w-0 min-h-0"
		data-testid="op-deck-card"
		:data-number="card.number"
		:data-quantity="card.quantity"
		:data-cost="card.cost ?? undefined"
	>
		<div class="relative" :style="cardStyle">
			<div class="mtg-card" :style="placeholderStyle">
				<img
					v-if="card.imageUrl"
					:src="card.imageUrl"
					:alt="card.name ?? card.number"
					class="w-full h-full object-cover"
				>
				<div v-else class="w-full h-full flex flex-col items-center justify-center gap-1 text-xs text-center p-1">
					<span>{{ card.name ?? card.number }}</span>
					<span v-if="card.name" class="opacity-70">{{ card.number }}</span>
				</div>
			</div>
			<div
				v-if="showQuantity && card.quantity > 1"
				class="absolute font-bold rounded-full flex items-center justify-center"
				:class="quantityPositionClass"
				:style="quantityBadgeStyle"
			>
				{{ card.quantity }}
			</div>
		</div>
	</div>
</template>
