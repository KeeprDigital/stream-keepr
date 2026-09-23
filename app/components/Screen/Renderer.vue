<script setup lang="ts">
import type { Component, ComponentPublicInstance } from 'vue';
import type { BackgroundLayer, ModeConfigsMap, ScreenConfig } from '~~/shared/types/screenConfig';
import { usePreferredDark } from '@vueuse/core';
import { screenModeSupportsBackgroundLayers } from '~~/shared/screenModes';
import { getScreenModeDefinition, resolveScreenModeHost } from '~/modules/screen-mode';

const { screen, overlayContainer } = useScreenContext();
const preferredDark = usePreferredDark();
const viewportWidth = ref(0);
const viewportHeight = ref(0);

function updateViewportSize() {
	if (!import.meta.client)
		return;
	viewportWidth.value = window.innerWidth;
	viewportHeight.value = window.innerHeight;
}

onMounted(() => {
	updateViewportSize();
	window.addEventListener('resize', updateViewportSize);
});

onBeforeUnmount(() => {
	window.removeEventListener('resize', updateViewportSize);
});

const currentMode = computed(() => screen.value?.currentMode ?? 'background');
const currentModeDefinition = computed(() => getScreenModeDefinition(currentMode.value));
const screenConfig = computed<ScreenConfig>(() => (screen.value?.screenConfig ?? {}) as ScreenConfig);

const displayComponent = computed<Component>(() => currentModeDefinition.value.displayComponent);
const host = computed(() => resolveScreenModeHost({
	mode: currentMode.value,
	screenConfig: screenConfig.value,
	viewportWidth: viewportWidth.value,
	viewportHeight: viewportHeight.value,
	preferredDark: preferredDark.value,
}));

/**
 * The active mode's own Background Layer stack, painted by this host behind
 * the mode's content. Only the plain overlay modes carry one — the Background
 * Screen renders its stack itself, and the graphics hosts stay transparent.
 */
const modeBackgroundLayers = computed<BackgroundLayer[]>(() => {
	const mode = currentMode.value;
	if (!screenModeSupportsBackgroundLayers(mode))
		return [];
	const modeConfigs = (screen.value?.modeConfigs ?? {}) as ModeConfigsMap;
	return modeConfigs[mode]?.backgroundLayers ?? [];
});

/**
 * The stack sits at z-index -1 so the unpositioned mode content paints over
 * it; that needs the container to be its own stacking context, or the stack
 * would slip behind the container's own Screen background.
 */
const containerBackgroundStyle = computed(() =>
	modeBackgroundLayers.value.length > 0
		? { position: 'relative' as const, isolation: 'isolate' as const }
		: undefined,
);

function setHostContainer(el: Element | ComponentPublicInstance | null) {
	overlayContainer.value = host.value.provideOverlayContainer && el instanceof HTMLElement ? el : null;
}
</script>

<template>
	<div
		class="screen-renderer-wrapper w-full h-full"
		:class="host.wrapperClass"
		:style="host.wrapperStyle"
	>
		<div
			:ref="setHostContainer"
			:class="host.containerClass"
			:style="[host.containerStyle, containerBackgroundStyle]"
		>
			<ScreenBackgroundLayerStack
				v-if="modeBackgroundLayers.length"
				class="screen-renderer__background"
				:layers="modeBackgroundLayers"
			/>
			<component :is="displayComponent" />
		</div>
	</div>
</template>

<style scoped>
.screen-renderer {
	display: grid;
	overflow: hidden;
	box-sizing: border-box;
	margin: 0;
	padding: 0;
}

/* Behind the in-flow mode content; the container isolates, so this stays above
   the container's own Screen background rather than escaping beneath it. */
.screen-renderer__background {
	z-index: -1;
}
</style>
