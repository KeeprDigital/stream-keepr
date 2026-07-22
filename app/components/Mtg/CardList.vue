<script lang="ts" setup>
import type { MtgCard } from '~/types/card/mtg';

const props = withDefaults(defineProps<{
	cards: MtgCard[];
	quantities?: Record<string, number>;
	points?: Record<string, number>;
	gap?: string;
}>(), {
	gap: '1.5rem',
});

const emit = defineEmits<{
	(e: 'selected', card: MtgCard, turnedOver: boolean): void;
}>();

function onCardSelected(card: MtgCard, turnedOver: boolean) {
	emit('selected', card, turnedOver);
}
</script>

<template>
	<div class="card-list-container" :style="{ '--card-list-gap': props.gap }">
		<div class="card-list">
			<div
				v-for="card in props.cards"
				:key="`${card.id}-${card.imageData.front?.normal}`"
				class="card-list-item"
			>
				<MtgCardImage
					:card="card"
					:display="card.displayData"
					display-mode="list"
					@selected="onCardSelected(card, $event)"
				/>
				<div
					v-if="props.quantities?.[card.id] != null"
					class="card-quantity"
				>
					{{ props.quantities[card.id] }}x
				</div>
				<div
					v-if="props.points?.[card.id] != null"
					class="card-points"
				>
					{{ props.points[card.id] }}
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.card-list-container {
	container-name: card-list;
	container-type: inline-size;

	.card-list {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: var(--card-list-gap);
	}

	@container (max-width: 1600px) {
		.card-list {
			grid-template-columns: repeat(6, 1fr);
		}
	}

	@container (max-width: 1440px) {
		.card-list {
			grid-template-columns: repeat(5, 1fr);
		}
	}

	@container (max-width: 1024px) {
		.card-list {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	@container (max-width: 768px) {
		.card-list {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@container (max-width: 480px) {
		.card-list {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@container (max-width: 320px) {
		.card-list {
			grid-template-columns: repeat(1, 1fr);
		}
	}
}

.card-list-item {
	position: relative;
}

.card-quantity {
	position: absolute;
	bottom: 0.5rem;
	right: 0.5rem;
	background: rgba(0, 0, 0, 0.8);
	color: white;
	padding: 0.25rem 0.75rem;
	border-radius: 0.5rem;
	font-size: 1.125rem;
	font-weight: 700;
	pointer-events: none;
}

.card-points {
	position: absolute;
	top: 0.5rem;
	left: 0.5rem;
	background: color-mix(in srgb, var(--ui-primary) 85%, black 15%);
	color: white;
	padding: 0.4rem 0.8rem;
	border-radius: 0.65rem;
	font-size: 1.25rem;
	font-weight: 700;
	line-height: 1;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
	pointer-events: none;
}
</style>
