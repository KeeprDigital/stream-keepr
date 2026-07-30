<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import {
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
} from '~~/shared/types/screenConfig';
import GraphicsCompositorCanvas from '~/components/Graphics/Compositor/Canvas.vue';
import { useBroadcastGraphicsModeData } from '~/composables/screen/useBroadcastGraphicsModeData';
import { resolveBroadcastGraphicsRenderModel } from '~/modules/broadcast-graphics/renderModel';

const { outputMode, previewGuides, previewSafeAreas, screen } = useScreenContext();
const { graphics, onAirGraphicIds, selectedTarget, publishSelection } = useBroadcastGraphicsModeData();

const resolvedOutput = computed<ScreenOutput>(() => outputMode?.value ?? 'overlay');
const canvasWidth = computed(() => screen?.value?.screenConfig?.width ?? DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH);
const canvasHeight = computed(() => screen?.value?.screenConfig?.height ?? DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT);

const renderModel = computed(() => resolveBroadcastGraphicsRenderModel({
	output: resolvedOutput.value,
	canvasWidth: canvasWidth.value,
	canvasHeight: canvasHeight.value,
	graphics: graphics.value,
	onAirGraphicIds: onAirGraphicIds.value,
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
