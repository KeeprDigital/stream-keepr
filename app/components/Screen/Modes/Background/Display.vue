<script setup lang="ts">
import type { BackgroundLayer } from '~~/shared/types/screenConfig';

const config = useScreenModeConfig('background');

const layers = computed<BackgroundLayer[]>(() => config.value.layers ?? []);
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
