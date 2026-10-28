<script setup lang="ts">
import type { ScreenMode } from '~~/shared/types/enums';

const { screen, viewport } = useScreenContext();
const windowWidth = ref(0);
const windowHeight = ref(0);
/** The space the Screen fits into: its context's when it names one, else the window. */
const viewportWidth = computed(() => viewport?.value.width ?? windowWidth.value);
const viewportHeight = computed(() => viewport?.value.height ?? windowHeight.value);

function updateViewportSize() {
	if (!import.meta.client)
		return;
	windowWidth.value = window.innerWidth;
	windowHeight.value = window.innerHeight;
}

onMounted(() => {
	updateViewportSize();
	window.addEventListener('resize', updateViewportSize);
});

onBeforeUnmount(() => {
	window.removeEventListener('resize', updateViewportSize);
});

const currentMode = computed<ScreenMode>(() => screen.value?.currentMode ?? 'background');

/**
 * Rendering Readiness: what is on program stays there until what replaces it
 * is ready. A mode change renders the incoming mode hidden behind the one on
 * program and cuts to it once it is ready; on a first load nothing shows until
 * then. A mode left before it was ready is dropped, and going back to the mode
 * on program drops the one loading.
 */
const shownMode = ref<ScreenMode | null>(null);
const incomingMode = ref<ScreenMode | null>(null);

watch(currentMode, (mode) => {
	incomingMode.value = mode === shownMode.value
		? null
		: mode;
}, { immediate: true });

function onFrameReady(mode: ScreenMode) {
	if (mode !== incomingMode.value)
		return;
	shownMode.value = mode;
	incomingMode.value = null;
}

const frames = computed(() => [shownMode.value, incomingMode.value].filter((mode): mode is ScreenMode => mode !== null));
</script>

<template>
	<div class="screen-renderer-wrapper w-full h-full">
		<ScreenRendererFrame
			v-for="mode in frames"
			:key="mode"
			:mode="mode"
			:shown="mode === shownMode"
			:viewport-width="viewportWidth"
			:viewport-height="viewportHeight"
			@ready="onFrameReady(mode)"
		/>
	</div>
</template>

<style scoped>
/* The rendering on program and the one loading behind it share one place. */
.screen-renderer-wrapper {
	display: grid;
}

.screen-renderer-wrapper > :deep(*) {
	grid-area: 1 / 1;
}
</style>
