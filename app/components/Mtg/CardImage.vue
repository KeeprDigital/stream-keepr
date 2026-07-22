<script setup lang="ts">
import type { MtgCard, MtgCardDisplayData } from '~/types/card/mtg';

const props = defineProps<{
	card: MtgCard;
	display: MtgCardDisplayData;
	displayMode: MtgCardDisplayMode;
}>();

const emit = defineEmits<{
	(e: 'selected', turnedOver: boolean): void;
}>();

const frontLoaded = ref(false);
const backLoaded = ref(false);
const previewingBack = ref(false);
const show = ref(false);
const initialTurnedOver = props.display.turnedOver;
let showTimer: ReturnType<typeof setTimeout> | null = null;

const mode = computed(() => mtgCardDisplayModes[props.displayMode]);

const canPreviewBack = computed(() => {
	return props.card.imageData.back
		&& mode.value.turnoverable
		&& frontLoaded.value
		&& backLoaded.value;
});

const scaleFactor = computed(() => {
	if (!show.value)
		return 1;

	const isRotated = props.display.rotated && mode.value.rotatable;
	const isCounterRotated = props.display.counterRotated && mode.value.counterRotatable;

	return (isRotated || isCounterRotated) ? 61 / 85 : 1;
});

function selected() {
	if (mode.value.selectable)
		emit('selected', previewingBack.value);
}

onMounted(() => {
	showTimer = setTimeout(() => {
		show.value = true;
		showTimer = null;
	}, 1000);
});

onBeforeUnmount(() => {
	if (showTimer)
		clearTimeout(showTimer);
});
</script>

<template>
	<div
		class="wrapper"
		:class="{
			animated: mode.animated,
			hoverable: mode.selectable,
		}"
		:role="mode.selectable ? 'button' : undefined"
		:tabindex="mode.selectable ? 0 : undefined"
		:aria-label="mode.selectable ? `Select card ${card.name}` : undefined"
		@click="selected()"
		@keydown.enter="selected()"
		@keydown.space.prevent="selected()"
	>
		<div class="card-image">
			<div
				class="card"
				:class="{
					'flipped': show && display.flipped,
					'rotated': show && mode.rotatable && display.rotated,
					'counter-rotated': show && mode.counterRotatable && display.counterRotated,
					'turned-over': (show || initialTurnedOver) && (display.turnedOver || previewingBack),
					'animated': mode.animated,
				}"
			>
				<div class="face front">
					<NuxtImg
						class="image"
						:src="card.imageData.front?.normal"
						loading="lazy"
						placeholder
						@load="frontLoaded = true"
					/>
				</div>
				<div
					v-if="card.imageData.back"
					class="face back"
				>
					<NuxtImg
						class="image"
						:src="card.imageData.back.normal"
						loading="lazy"
						placeholder
						@load="backLoaded = true"
					/>
				</div>
			</div>
			<MtgCardImageTurnover
				v-if="canPreviewBack"
				@preview-back="previewingBack = $event"
			/>
		</div>
	</div>
</template>

<style scoped>
.wrapper {
	width: 100%;
	scale: v-bind(scaleFactor);

	&.animated {
		transition: scale 0.6s ease-in-out;
		.card {
			transition: transform 0.6s ease-in-out;
		}
	}

	&.hoverable {
		cursor: pointer;
		transition: scale 0.1s ease-in-out;

		&:hover {
			scale: 1.03;
		}
	}
}

.card-image {
	aspect-ratio: 61/85;
	perspective: 2000px;
	position: relative;
	border-radius: 4.75% / 4%;
	width: 100%;
	margin: 0 auto;

	.card {
		position: relative;
		transform-style: preserve-3d;
		transform-origin: center;
		width: 100%;
		height: 100%;

		.face {
			position: absolute;
			inset: 0;
			backface-visibility: hidden;

			.image {
				border-radius: 4.75% / 4%;
				width: 100%;
				height: 100%;
				object-fit: cover;
			}

			&.front {
				transform: rotateY(0deg);
			}
			&.back {
				transform: rotateY(180deg);
			}
		}

		&.flipped {
			transform: rotate(180deg);
		}

		&.rotated {
			transform: rotate(90deg);
		}

		&.counter-rotated {
			transform: rotate(-90deg);
		}

		&.turned-over {
			transform: rotateY(180deg);
		}
	}
}
</style>
