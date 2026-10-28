<script setup lang="ts">
import type { MtgCard } from '~/types/card/mtg';
import { modeMotionVars, useScreenModeReady } from '~/modules/screen-mode';
import { createGuardedSequence } from '~/utils/guardedSequence';
import { preloadImages } from '~/utils/preloadImage';

const props = defineProps<{
	/** The Screen Card to show; null shows none, leaving with its exit animation. */
	card: MtgCard | null;
	/** The card's width in Event Canvas px, as a CSS length. */
	width: string;
}>();

const showCard = ref(false);
const displayCard = ref<MtgCard | null>(null);
/** A card whose images have loaded, waiting for the one shown to leave. */
const pendingCard = ref<MtgCard | null>(null);
const preloading = ref(false);
let leaving = false;
let showCardTimer: ReturnType<typeof setTimeout> | null = null;
const loads = createGuardedSequence();

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

function cardImageUrls(card: MtgCard): string[] {
	return [card.imageData.front?.normal, card.imageData.back?.normal]
		.filter((url): url is string => !!url);
}

/** Enters the card shown, once it has mounted. */
function reveal(cardId: string) {
	clearShowCardTimer();
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

function leave() {
	clearShowCardTimer();
	if (showCard.value) {
		leaving = true;
		showCard.value = false;
	}
	else if (!leaving) {
		displayCard.value = pendingCard.value;
		pendingCard.value = null;
	}
}

/**
 * The card on program stays until its replacement's images have loaded; then
 * it leaves and the replacement enters. The same card updates in place, so a
 * flip or rotation animates on the card shown.
 */
watch(() => props.card, async (next) => {
	const flight = loads.begin();
	preloading.value = false;
	if (!next) {
		pendingCard.value = null;
		leave();
		return;
	}
	if (displayCard.value?.id === next.id && !leaving) {
		pendingCard.value = null;
		displayCard.value = next;
		if (!showCard.value)
			reveal(next.id);
		return;
	}

	preloading.value = true;
	await preloadImages(cardImageUrls(next));
	if (flight.stale)
		return;
	preloading.value = false;
	if (displayCard.value && (showCard.value || leaving)) {
		pendingCard.value = next;
		leave();
		return;
	}
	displayCard.value = next;
	reveal(next.id);
}, { immediate: true });

useScreenModeReady(() => !preloading.value);

onBeforeUnmount(() => {
	clearShowCardTimer();
	loads.supersede();
});

// The card that left gives way to the one waiting, if any.
function onAfterLeave() {
	leaving = false;
	displayCard.value = pendingCard.value;
	pendingCard.value = null;
	if (displayCard.value)
		reveal(displayCard.value.id);
}
</script>

<template>
	<div
		v-if="displayCard"
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
