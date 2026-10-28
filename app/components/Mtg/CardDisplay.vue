<script setup lang="ts">
import type { MtgCard } from '~/types/card/mtg';
import { modeMotionVars } from '~/modules/screen-mode';

const props = defineProps<{
	/** The Screen Card to show; null shows none, leaving with its exit animation. */
	card: MtgCard | null;
	/** The card's width in Event Canvas px, as a CSS length. */
	width: string;
}>();

const imageLoaded = ref(false);
const showCard = ref(false);
const displayCard = ref<MtgCard | null>(null);
let showCardTimer: ReturnType<typeof setTimeout> | null = null;

function clearShowCardTimer() {
	if (showCardTimer)
		clearTimeout(showCardTimer);
	showCardTimer = null;
}

const CARD_ASPECT_RATIO = 85 / 61;
/** The card's width in Event Canvas pixels, and the square it turns within: its diagonal. */
const cardWidth = computed(() => props.width);
const turningSquare = computed(() => `calc(${cardWidth.value} * ${Math.sqrt(1 + CARD_ASPECT_RATIO ** 2)})`);

// Container style — always centers the card within the diagonal rotation container.
// Viewport-level positioning is handled by the Renderer, not this component.
const containerStyle = computed(() => ({
	width: turningSquare.value,
	height: turningSquare.value,
	justifyItems: 'center',
	alignItems: 'center',
}));

/**
 * The card enters from its `motion` Mode Token's excursion and leaves back to
 * it, on the token's timing. The transition classes read the excursion.
 */
const motion = modeMotionVars('card', 'motion');
const motionStyle = {
	'transitionProperty': 'opacity, transform, clip-path',
	'transitionDuration': motion.duration,
	'transitionTimingFunction': motion.easing,
	'transitionDelay': motion.delay,
	'transformOrigin': motion.transformOrigin,
	'--card-motion-opacity': motion.opacity,
	'--card-motion-transform': motion.transform,
	'--card-motion-clip': motion.clipPath,
};

// Watch for card changes and reset loading state
watch(() => props.card, (newCard) => {
	if (newCard) {
		// Same card ID - just update in place (smooth CSS transition for flip/rotate)
		if (displayCard.value?.id === newCard.id) {
			displayCard.value = newCard;
			return;
		}
		// Different card: reset and prepare for preload
		clearShowCardTimer();
		displayCard.value = newCard;
		imageLoaded.value = false;
		showCard.value = false;
	}
	else {
		// Card cleared: trigger exit animation
		clearShowCardTimer();
		showCard.value = false;
	}
}, { immediate: true });

// When image loads, wait a moment then show with animation
function onImageLoad(cardId: string) {
	if (displayCard.value?.id !== cardId)
		return;
	clearShowCardTimer();
	imageLoaded.value = true;
	void nextTick(() => {
		if (displayCard.value?.id !== cardId)
			return;
		showCardTimer = setTimeout(() => {
			if (displayCard.value?.id === cardId)
				showCard.value = true;
			showCardTimer = null;
		}, 50);
	});
}

onBeforeUnmount(clearShowCardTimer);

// Clear displayCard after exit animation completes
function onAfterLeave() {
	displayCard.value = null;
	imageLoaded.value = false;
}
</script>

<template>
	<div
		v-if="displayCard && imageLoaded"
		:key="displayCard.id"
		class="card-container"
		:style="containerStyle"
	>
		<div data-testid="spotlight-card" :style="{ width: cardWidth }">
			<!-- Card -->
			<transition mode="out-in" name="card-motion" @after-leave="onAfterLeave">
				<div v-if="showCard" class="card-image-wrapper" :style="motionStyle">
					<MtgCardImage
						:card="displayCard"
						:display="displayCard.displayData"
						display-mode="output"
					/>
				</div>
			</transition>
		</div>
	</div>
	<!-- Hidden image preloader -->
	<div v-if="displayCard && !imageLoaded" class="hidden">
		<img
			:src="displayCard.imageData.front?.normal"
			@load="onImageLoad(displayCard.id)"
		>
	</div>
</template>

<style scoped>
.card-container {
	display: grid;
	transition: all 0.6s ease-in-out;
	box-sizing: border-box;
}

.card-image-wrapper {
	position: relative;
	opacity: 1;
	transform: none;
	clip-path: inset(0 0 0 0);
}

.card-motion-enter-from,
.card-motion-leave-to {
	opacity: var(--card-motion-opacity);
	transform: var(--card-motion-transform);
	clip-path: var(--card-motion-clip);
}
</style>
