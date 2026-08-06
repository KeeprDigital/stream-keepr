<script setup lang="ts">
import type { Component, ComponentPublicInstance } from 'vue';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { usePreferredDark } from '@vueuse/core';
import { getScreenModeDefinition, resolveScreenModeHost } from '~/modules/screen-mode';

const { screen, overlayContainer, isPreview, outputMode } = useScreenContext();
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

const currentMode = computed(() => screen.value?.currentMode ?? 'idle');
const currentModeDefinition = computed(() => getScreenModeDefinition(currentMode.value));
const screenConfig = computed<ScreenConfig>(() => (screen.value?.screenConfig ?? {}) as ScreenConfig);

const displayComponent = computed<Component>(() => currentModeDefinition.value.displayComponent);
const showTransparentPreviewBackdrop = computed(() => isPreview?.value === true && outputMode?.value === 'overlay');

const host = computed(() => resolveScreenModeHost({
	mode: currentMode.value,
	screenConfig: screenConfig.value,
	viewportWidth: viewportWidth.value,
	viewportHeight: viewportHeight.value,
	preferredDark: preferredDark.value,
}));

function setHostContainer(el: Element | ComponentPublicInstance | null) {
	overlayContainer.value = host.value.provideOverlayContainer && el instanceof HTMLElement ? el : null;
}
</script>

<template>
	<div
		class="screen-renderer-wrapper w-full h-full"
		:class="[host.wrapperClass, { 'transparent-checkerboard-backdrop': showTransparentPreviewBackdrop }]"
		:style="host.wrapperStyle"
	>
		<div
			:ref="setHostContainer"
			:class="host.containerClass"
			:style="host.containerStyle"
		>
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
</style>
