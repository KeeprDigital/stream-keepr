<script lang="ts" setup>
/** One One Piece Printing's image, shown as printed: it never flips, rotates or turns over. */
const props = withDefaults(defineProps<{
	card: { name: string; imageUrl: string };
	/** Offers the image as a button that emits `selected`. */
	selectable?: boolean;
	/** Marks the image as the one chosen among its siblings. */
	selected?: boolean;
}>(), {
	selectable: false,
	selected: undefined,
});

const emit = defineEmits<{
	(e: 'selected'): void;
}>();

function select() {
	if (props.selectable)
		emit('selected');
}
</script>

<template>
	<div
		class="op-card"
		:class="{ selectable: props.selectable, chosen: props.selected }"
		:role="props.selectable ? 'button' : undefined"
		:tabindex="props.selectable ? 0 : undefined"
		:aria-label="props.selectable ? `Select card ${props.card.name}` : undefined"
		:aria-pressed="props.selectable ? props.selected : undefined"
		@click="select"
		@keydown.enter="select"
		@keydown.space.prevent="select"
	>
		<img
			class="image"
			:src="props.card.imageUrl"
			:alt="props.card.name"
			loading="lazy"
		>
	</div>
</template>

<style scoped>
.op-card {
	aspect-ratio: 600 / 838;
	width: 100%;
	border-radius: var(--mtg-card-radius);

	.image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: var(--mtg-card-radius);
	}

	&.selectable {
		cursor: pointer;
		transition: scale 0.1s ease-in-out;

		&:hover {
			scale: 1.03;
		}
	}

	&.chosen {
		outline: 3px solid var(--ui-primary);
		outline-offset: 2px;
	}
}
</style>
