<script setup lang="ts">
import type { CardSizing } from '~~/shared/types/enums';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { ninePointPlacement } from '~~/shared/utils/ninePoints';

/**
 * A grid of card images, for any Screen Mode that lays cards out.
 *
 * A Fit grid takes the space its parent leaves it and gives every column the
 * one card width at which all `rows` rows fit it too, so the cards sit `gap`
 * apart both ways and the grid sits at `alignment` in the space. A Fixed grid sizes its
 * tracks to the cards, which take their own width, and may overflow;
 * `'auto-fill'` fits as many `cardWidth` tracks as there is room for.
 */
const props = withDefaults(defineProps<{
	sizing: CardSizing;
	columns: number | 'auto-fill';
	/** A Fit grid's row count. */
	rows?: number;
	cardWidth: string;
	gap: string;
	/** Height each Fit row spends beside its card image, such as a name label under it. */
	labelHeight?: string;
	/** Where the cards sit in the space they leave over: both ways for Fit, across for Fixed. */
	alignment?: NinePoint;
	/** A Fit card width worked out by the grid's host, as a whole Deck's is, in place of its own. */
	fitCardWidth?: string;
}>(), {
	rows: 1,
	labelHeight: '0px',
	alignment: 'center',
});

const placement = computed(() => ninePointPlacement(props.alignment));

// 61 / 85 is the `mtg-card` aspect, as CARD_ASPECT in shared/utils/cardGrid.ts.
const fitCardWidth = computed(() => {
	if (props.fitCardWidth)
		return props.fitCardWidth;
	const columns = typeof props.columns === 'number'
		? props.columns
		: 1;
	const byWidth = `calc((100cqw - ${columns - 1} * ${props.gap}) / ${columns})`;
	const byHeight = `calc(((100cqh - ${props.rows - 1} * ${props.gap}) / ${props.rows} - ${props.labelHeight}) * 61 / 85)`;
	return `max(0px, min(${byWidth}, ${byHeight}))`;
});

/** The Fit space places its grid at the alignment point. */
const fitSpaceStyle = computed(() => ({
	placeContent: `${placement.value.y} ${placement.value.x}`,
}));

const fitGridStyle = computed(() => ({
	gridTemplateColumns: `repeat(${props.columns}, ${fitCardWidth.value})`,
	gap: props.gap,
}));

const fixedGridStyle = computed(() => ({
	gridTemplateColumns: props.columns === 'auto-fill'
		? `repeat(auto-fill, ${props.cardWidth})`
		: `repeat(${props.columns}, max-content)`,
	gap: props.gap,
	// Placed across while it fits; wider, it overflows its end, never clipping its first column.
	justifyContent: `safe ${placement.value.x}`,
}));
</script>

<template>
	<div
		v-if="sizing === 'fit'"
		class="card-grid-fit"
		:style="fitSpaceStyle"
		data-card-sizing="fit"
		:data-columns="columns"
		:data-rows="rows"
	>
		<div class="grid" :style="fitGridStyle">
			<slot />
		</div>
	</div>
	<div
		v-else
		class="card-grid grid"
		:style="fixedGridStyle"
		data-card-sizing="fixed"
		:data-columns="columns"
	>
		<slot />
	</div>
</template>

<style scoped>
/*
 * The space a Fit grid is given; its columns read its size, and it places them at its alignment.
 * A badge a card wears just outside its edge may overhang it, into the Screen inset.
 */
.card-grid-fit {
	flex: 1 1 0%;
	min-height: 0;
	container-type: size;
	display: grid;
}
</style>
