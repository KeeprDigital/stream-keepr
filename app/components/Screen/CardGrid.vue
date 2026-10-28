<script setup lang="ts">
import type { CardSizing } from '~~/shared/types/enums';

/**
 * A grid of card images, for any Screen Mode that lays cards out. A Fit grid
 * takes the height its parent leaves it and shares it between `rows` equal
 * rows, so each card, in an `MtgCardFitBox`, fits its cell and none overflow.
 * A Fixed grid sizes its tracks to the cards, which take their own width, and
 * may overflow; `'auto-fill'` fits as many `cardWidth` tracks as there is room for.
 */
const props = defineProps<{
	sizing: CardSizing;
	columns: number | 'auto-fill';
	/** A Fit grid's row count. */
	rows?: number;
	cardWidth: string;
	gap: string;
}>();

const gridStyle = computed(() => {
	if (props.sizing === 'fit') {
		return {
			gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
			gridTemplateRows: `repeat(${props.rows ?? 1}, minmax(0, 1fr))`,
			gap: props.gap,
		};
	}
	return {
		gridTemplateColumns: props.columns === 'auto-fill'
			? `repeat(auto-fill, ${props.cardWidth})`
			: `repeat(${props.columns}, max-content)`,
		gap: props.gap,
		// Centred while it fits; wider, it overflows its end, never clipping its first column.
		justifyContent: 'safe center',
	};
});
</script>

<template>
	<div
		class="card-grid grid"
		:class="{ 'card-grid--fit': sizing === 'fit' }"
		:style="gridStyle"
		:data-card-sizing="sizing"
		:data-columns="columns"
		:data-rows="sizing === 'fit' ? rows : undefined"
	>
		<slot />
	</div>
</template>

<style scoped>
.card-grid--fit {
	flex: 1 1 0%;
	min-height: 0;
}
</style>
