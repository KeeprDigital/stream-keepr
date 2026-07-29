<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { resolveBroadcastGraphicsRenderModel } from '~/modules/broadcast-graphics/renderModel';

const { outputMode } = useScreenContext();
const config = useScreenModeConfig('broadcast-graphics');
const resolvedOutput = computed<ScreenOutput>(() => outputMode?.value ?? 'overlay');
const renderModel = computed(() => resolveBroadcastGraphicsRenderModel({
	config: config.value,
	output: resolvedOutput.value,
}));
</script>

<template>
	<div
		class="broadcast-graphics"
		:class="`broadcast-graphics--${renderModel.output}`"
		:style="renderModel.canvasStyle"
	/>
</template>
