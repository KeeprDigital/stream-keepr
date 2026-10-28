<script setup lang="ts">
import type { Component, ComponentPublicInstance } from 'vue';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BackgroundLayer, ModeConfigsMap } from '~~/shared/types/screenConfig';
import { DEFAULT_EVENT_CANVAS } from '~~/shared/eventCanvas';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { screenModeSupportsBackgroundLayers } from '~~/shared/screenModes';
import {
	getScreenModeDefinition,
	provideScreenModeReadiness,
	resolveScreenModeHost,
	SCREEN_MODE_READY_TIMEOUT_MS,
	screenBackgroundLayers,
	screenModeThemeFontReferences,
	screenModeThemeTokenStyle,
} from '~/modules/screen-mode';
import { waitForRenderedMedia } from '~/utils/renderedMediaReadiness';

/**
 * One Screen Mode's rendering inside the Screen renderer: its host container,
 * its Background Layer stack and its display. It renders hidden until it is
 * ready — its display has declared its data settled, its Theme fonts have
 * loaded, and every image, video and pending part inside it has loaded or
 * failed — and says so once, so the renderer can keep what is on program
 * until then.
 */
const props = defineProps<{
	mode: ScreenMode;
	/** Whether it is on program, rather than loading behind what is. */
	shown: boolean;
	viewportWidth: number;
	viewportHeight: number;
}>();

const emit = defineEmits<{
	ready: [];
}>();

const { screen, overlayContainer, themeTokens, eventCanvas } = useScreenContext();

const displayComponent = computed<Component>(() => getScreenModeDefinition(props.mode).displayComponent);
const host = computed(() => resolveScreenModeHost({
	mode: props.mode,
	canvas: eventCanvas?.value ?? DEFAULT_EVENT_CANVAS,
	theme: themeTokens?.value ?? DEFAULT_THEME_TOKENS,
	overrides: screen.value?.themeOverrides ?? {},
	viewportWidth: props.viewportWidth,
	viewportHeight: props.viewportHeight,
}));

/**
 * The mode's Background Layer stack, painted by this host behind the mode's
 * content: its own, else its Theme's background. Only the plain overlay modes
 * carry one — the Background Screen renders its stack itself, and the
 * graphics hosts stay transparent.
 */
const modeBackgroundLayers = computed<BackgroundLayer[]>(() => {
	if (!screenModeSupportsBackgroundLayers(props.mode))
		return [];
	const modeConfigs = (screen.value?.modeConfigs ?? {}) as ModeConfigsMap;
	return screenBackgroundLayers(modeConfigs[props.mode]?.backgroundLayers, themeTokens?.value ?? DEFAULT_THEME_TOKENS, screen.value?.themeOverrides ?? {});
});

/**
 * The stack sits at z-index -1 so the unpositioned mode content paints over
 * it; that needs the container to be its own stacking context, or the stack
 * would slip behind whatever the container sits on.
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
	props.mode,
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
	props.mode,
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
const themeFontsSettled = computed(() => themeFontsReady.value || themeFontsFailed.value);
const themeFontStyle = computed(() => themeFontsSettled.value
	? undefined
	: { visibility: 'hidden' as const });

// ── Rendering Readiness ──

const { declared } = provideScreenModeReadiness();
const container = ref<HTMLElement | null>(null);
const ready = ref(false);
let disposed = false;
let readyCheck = 0;
let readyTimeout: ReturnType<typeof setTimeout> | undefined;

function becomeReady() {
	if (ready.value || disposed)
		return;
	ready.value = true;
	clearTimeout(readyTimeout);
	emit('ready');
}

onMounted(() => {
	readyTimeout = setTimeout(() => {
		if (!ready.value)
			console.warn(`Screen Mode "${props.mode}" was not ready after ${SCREEN_MODE_READY_TIMEOUT_MS} ms; showing it anyway.`);
		becomeReady();
	}, SCREEN_MODE_READY_TIMEOUT_MS);
});

watch([declared, themeFontsSettled, container], async ([isDeclared, fontsSettled, element]) => {
	if (ready.value || !isDeclared || !fontsSettled || !element)
		return;
	const check = ++readyCheck;
	// What the declaration settled renders on the next tick, and its media
	// starts loading only then.
	await nextTick();
	await waitForRenderedMedia(element);
	if (check === readyCheck && declared.value)
		becomeReady();
}, { immediate: true });

onBeforeUnmount(() => {
	disposed = true;
	clearTimeout(readyTimeout);
});

function setContainer(el: Element | ComponentPublicInstance | null) {
	container.value = el instanceof HTMLElement
		? el
		: null;
}

/** Only the rendering on program hosts overlays. */
watch([
	() => props.shown,
	container,
	() => host.value.provideOverlayContainer,
], ([shown, element, provides]) => {
	if (shown)
		overlayContainer.value = provides ? element : null;
}, { immediate: true });
</script>

<template>
	<div
		:ref="setContainer"
		:class="host.containerClass"
		:style="[host.containerStyle, containerBackgroundStyle, themeTokenStyle, shown ? undefined : { visibility: 'hidden' }]"
		:data-screen-mode="mode"
		:data-screen-mode-ready="ready.toString()"
		:aria-hidden="shown ? undefined : 'true'"
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
</template>

<style scoped>
.screen-renderer {
	display: grid;
	overflow: hidden;
	box-sizing: border-box;
	/* A display sizes against its Event Canvas (`cqw`, `cqh`), never the window. */
	container-type: size;
	margin: 0;
	padding: 0;
}

/* Behind the in-flow mode content; the container isolates, so this stays
   within the container rather than escaping beneath it. */
.screen-renderer__background {
	z-index: -1;
}
</style>
