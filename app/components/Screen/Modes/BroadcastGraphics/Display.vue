<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { getScreenModeGraphicsCanvas } from '~~/shared/screenModes';
import GraphicsCompositorCanvas from '~/components/Graphics/Compositor/Canvas.vue';
import { useBroadcastGraphicsModeData } from '~/composables/screen/useBroadcastGraphicsModeData';
import { resolveBroadcastGraphicsRenderModel } from '~/modules/broadcast-graphics/renderModel';

const { outputMode, previewGuides, previewSafeAreas, screen } = useScreenContext();
const { animationProjection, graphics, onAirGraphicIds, selectedTarget, publishSelection } = useBroadcastGraphicsModeData();

const resolvedOutput = computed<ScreenOutput>(() => outputMode?.value ?? 'overlay');
const canvasDefaults = getScreenModeGraphicsCanvas('broadcast-graphics');
const canvasWidth = computed(() => screen?.value?.screenConfig?.width ?? canvasDefaults.width);
const canvasHeight = computed(() => screen?.value?.screenConfig?.height ?? canvasDefaults.height);

const renderModel = computed(() => resolveBroadcastGraphicsRenderModel({
	output: resolvedOutput.value,
	canvasWidth: canvasWidth.value,
	canvasHeight: canvasHeight.value,
	graphics: graphics.value,
	onAirGraphicIds: onAirGraphicIds.value,
	animation: animationProjection.value,
	itemGuides: previewGuides?.value ?? false,
	safeAreaGuides: previewSafeAreas?.value ?? false,
	selectedTarget: selectedTarget.value,
}));
</script>

<template>
	<GraphicsCompositorCanvas
		class="broadcast-graphics"
		:class="`broadcast-graphics--${renderModel.output}`"
		:render="renderModel"
		@select="publishSelection"
	/>
</template>
