<script setup lang="ts">
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { screenBackgroundLayers } from '~/modules/screen-mode';

const config = useScreenModeConfig('background');
const { themeTokens } = useScreenContext();

/** The Screen's own stack, else its Theme's background. */
const layers = computed<BackgroundLayer[]>(() => screenBackgroundLayers(
	config.value.layers,
	themeTokens?.value ?? DEFAULT_THEME_TOKENS,
	{},
));
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
