<script setup lang="ts">
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { screenBackgroundLayers, useScreenModeReady } from '~/modules/screen-mode';

const context = useScreenContext();
const config = useScreenModeConfig(context, 'background');
const { themeTokens } = context;

/** The Screen's own stack, else its Theme's background. */
const layers = computed<BackgroundLayer[]>(() => screenBackgroundLayers(
	config.value.layers,
	themeTokens?.value ?? DEFAULT_THEME_TOKENS,
));

// Its stack reads no data; what it shows marks itself pending while it loads.
useScreenModeReady(true);
</script>

<template>
	<div class="background-screen">
		<ScreenBackgroundLayerStack :layers="layers" />
	</div>
</template>

<style scoped>
.background-screen {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	/* Empty — and anything the stack leaves uncovered — is black, not host chrome. */
	background: #000;
}
</style>
