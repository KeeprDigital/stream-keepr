<script setup lang="ts">
import type { Component, ComponentPublicInstance } from 'vue';
import type { BackgroundLayer, ModeConfigsMap, ScreenConfig } from '~~/shared/types/screenConfig';
import { usePreferredDark } from '@vueuse/core';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { screenModeSupportsBackgroundLayers } from '~~/shared/screenModes';
import { getScreenModeDefinition, resolveScreenModeHost, screenBackgroundLayers, screenModeThemeFontReferences, screenModeThemeTokenStyle } from '~/modules/screen-mode';

const { screen, overlayContainer, themeTokens } = useScreenContext();
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
 * The active mode's Background Layer stack, painted by this host behind the
 * mode's content: its own, else its Theme's background. Only the plain overlay
 * modes carry one — the Background Screen renders its stack itself, and the
 * graphics hosts stay transparent.
 */
const modeBackgroundLayers = computed<BackgroundLayer[]>(() => {
	const mode = currentMode.value;
	if (!screenModeSupportsBackgroundLayers(mode))
		return [];
	const modeConfigs = (screen.value?.modeConfigs ?? {}) as ModeConfigsMap;
	return screenBackgroundLayers(modeConfigs[mode]?.backgroundLayers, themeTokens?.value ?? DEFAULT_THEME_TOKENS, screen.value?.themeOverrides ?? {});
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
 * The mode's resolved Mode Tokens, as the custom properties its display reads:
 * the Screen's own Screen Theme Overrides over its Event's Theme.
 */
const themeTokenStyle = computed(() => screenModeThemeTokenStyle(
	currentMode.value,
	themeTokens?.value ?? DEFAULT_THEME_TOKENS,
	screen.value?.themeOverrides ?? {},
));

/**
 * The library fonts the mode's typography Mode Tokens resolve to, loaded as
 * `FontFace`s through the Screen Output Asset Capability, which admits what
 * the Screen's resolved tokens supply (ADR-0050). The mode's display hides
 * while they load, so text never flashes in a fallback face, and the
 * background behind it stays on air; a font that fails shows its fallback
 * rather than a blank display.
 */
const themeFontReferences = computed(() => screenModeThemeFontReferences(
	currentMode.value,
	themeTokens?.value ?? DEFAULT_THEME_TOKENS,
	screen.value?.themeOverrides ?? {},
));
const themeFontAssets = computed(() => themeFontReferences.value.map(({ reference }) => reference));
const { contentUrl: themeFontUrl, contentUrlsSettled: themeFontUrlsSettled } = useScreenGraphicAssetContentUrls(themeFontAssets);
const { fontsReady: themeFontsReady, fontsFailed: themeFontsFailed } = useGraphicAssetFontFaces(
	themeFontReferences,
	themeFontUrl,
	themeFontUrlsSettled,
);
const themeFontStyle = computed(() => themeFontsReady.value || themeFontsFailed.value
	? undefined
	: { visibility: 'hidden' as const });

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
			:data-font-ready="themeFontsReady.toString()"
			:data-font-error="themeFontsFailed.toString()"
		>
			<ScreenBackgroundLayerStack
				v-if="modeBackgroundLayers.length"
				class="screen-renderer__background"
				:layers="modeBackgroundLayers"
			/>
			<component :is="displayComponent" :style="themeFontStyle" />
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
