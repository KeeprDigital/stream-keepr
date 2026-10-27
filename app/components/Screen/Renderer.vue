<script setup lang="ts">
import type { Component, ComponentPublicInstance } from 'vue';
import type { BackgroundLayer, ModeConfigsMap, ScreenConfig } from '~~/shared/types/screenConfig';
import { usePreferredDark } from '@vueuse/core';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { screenModeSupportsBackgroundLayers } from '~~/shared/screenModes';
import { getScreenModeDefinition, resolveScreenModeHost, screenModeThemeTokenStyle } from '~/modules/screen-mode';

const { screen, overlayContainer, themeTokens, viewport } = useScreenContext();
const preferredDark = usePreferredDark();
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

/**
 * The mode's resolved Mode Tokens, as the custom properties its display reads.
 * The Screen carries no Screen Theme Overrides yet.
 */
const themeTokenStyle = computed(() => screenModeThemeTokenStyle(
	currentMode.value,
	themeTokens?.value ?? DEFAULT_THEME_TOKENS,
	{},
));

function setHostContainer(el: Element | ComponentPublicInstance | null) {
	overlayContainer.value = host.value.provideOverlayContainer && el instanceof HTMLElement
		? el
		: null;
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
			:style="[host.containerStyle, containerBackgroundStyle, themeTokenStyle]"
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
