<script setup lang="ts">
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { ninePointPlacement } from '~~/shared/utils/ninePoints';

/**
 * A grid of card images, for any Screen Mode that lays cards out.
 *
 * Its host solves the Card Layout (`solveCardGrid`, `solveDeckLayout`) and
 * passes what it solved: the `columns`, each one `cardWidth` wide, `gap` apart
 * both ways. The grid takes the space its parent leaves it and sits at
 * `alignment` in whatever the cards leave over, so its host can measure that
 * space.
 */
const props = withDefaults(defineProps<{
	columns: number;
	/** The rows of one page. */
	rows?: number;
	/** The solved card width. */
	cardWidth: string;
	gap: string;
	/** Where the cards sit in the space they leave over. */
	alignment?: NinePoint;
}>(), {
	rows: 1,
	alignment: 'center',
});

const placement = computed(() => ninePointPlacement(props.alignment));

/** The space places its grid at the alignment point. */
const spaceStyle = computed(() => ({
	placeContent: `${placement.value.y} ${placement.value.x}`,
}));

const gridStyle = computed(() => ({
	gridTemplateColumns: `repeat(${props.columns}, ${props.cardWidth})`,
	gap: props.gap,
}));
</script>

<template>
	<div
		class="card-grid-space"
		:style="spaceStyle"
		:data-columns="columns"
		:data-rows="rows"
	>
		<div class="grid" :style="gridStyle">
			<slot />
		</div>
	</div>
</template>

<style scoped>
/*
 * The space a grid is given; its host reads its size, and it places its grid at its alignment.
 * Its size is its parent's to give, never its cards' to take, so a host measuring it reads the space, not the grid.
 * A badge a card wears just outside its edge may overhang it, into the Screen inset.
 */
.card-grid-space {
	flex: 1 1 0%;
	min-height: 0;
	container-type: size;
	display: grid;
}
</style>
