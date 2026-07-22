<script setup lang="ts">
import type { CardDisplayConfig } from '~~/shared/types/screenConfig';
import type { MtgCard } from '~/types/card/mtg';
import { useElementSize } from '@vueuse/core';
import { DEFAULT_CARD_DISPLAY_CONFIG } from '~~/shared/types/screenConfig';
import { mtgCardSizeFromHeight } from '~~/shared/utils/card/size';

const props = withDefaults(defineProps<{
	config?: CardDisplayConfig;
	screenId: number;
}>(), {
	config: () => DEFAULT_CARD_DISPLAY_CONFIG,
});

const { overlayContainer } = useScreenContext();
const cardStore = useCardStore();
const { activeCard } = storeToRefs(cardStore);
const { height: containerHeight } = useElementSize(overlayContainer);

const imageLoaded = ref(false);
const showCard = ref(false);
const displayCard = ref<MtgCard | null>(null);
let showCardTimer: ReturnType<typeof setTimeout> | null = null;

function clearShowCardTimer() {
	if (showCardTimer)
		clearTimeout(showCardTimer);
	showCardTimer = null;
}

// Size cards from the rendered overlay container so fixed screen dimensions stay exact.
const cardDimensions = computed(() => {
	const baseDimensions = mtgCardSizeFromHeight(Math.max(containerHeight.value, 80));
	const scale = props.config?.scale ?? 1;
	return {
		cardWidth: baseDimensions.cardWidth * scale,
		cardHeight: baseDimensions.cardHeight * scale,
		diagonal: baseDimensions.diagonal * scale,
	};
});

// Animation speed mapping (in seconds)
const animationSpeedMap = {
	slow: 0.4,
	normal: 0.2,
	fast: 0.1,
};

const animationDuration = computed(() => {
	if (!props.config?.animationEnabled)
		return 0;
	return animationSpeedMap[props.config?.animationSpeed ?? 'normal'];
});

// Container style — always centers the card within the diagonal rotation container.
// Viewport-level positioning is handled by the Renderer, not this component.
const containerStyle = computed(() => ({
	'width': `${cardDimensions.value.diagonal}px`,
	'height': `${cardDimensions.value.diagonal}px`,
	'justifyItems': 'center',
	'alignItems': 'center',
	'--animation-duration': `${animationDuration.value}s`,
}));

async function loadCardForScreen() {
	cardStore.setActiveScreen(props.screenId);
	await cardStore.loadActiveCard();
}

// Load active card on mount and when screenId changes
onMounted(async () => {
	await loadCardForScreen();
});

watch(() => props.screenId, async () => {
	if (!import.meta.client) {
		return;
	}
	await loadCardForScreen();
});

// Watch for card changes and reset loading state
watch(activeCard, (newCard) => {
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
});

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
		<div :style="{ width: `${cardDimensions.cardWidth}px` }">
			<!-- Card -->
			<transition mode="out-in" name="zoom-fade" @after-leave="onAfterLeave">
				<div v-if="showCard" class="card-image-wrapper">
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
}

.zoom-fade-enter-active,
.zoom-fade-leave-active {
	transition:
		transform var(--animation-duration, 0.2s) cubic-bezier(0.5, 0, 0.5, 1),
		opacity var(--animation-duration, 0.2s) ease-out;
}

.zoom-fade-enter-from {
	opacity: 0;
	transform: scale(0.7);
}

.zoom-fade-enter-to {
	opacity: 1;
	transform: scale(1);
}

.zoom-fade-leave-from {
	opacity: 1;
	transform: scale(1);
}

.zoom-fade-leave-to {
	opacity: 0;
	transform: scale(0.7);
}
</style>
