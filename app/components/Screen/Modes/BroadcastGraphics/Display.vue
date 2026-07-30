<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { getScreenModeGraphicsCanvas } from '~~/shared/screenModes';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import GraphicsCompositorCanvas from '~/components/Graphics/Compositor/Canvas.vue';
import { useBroadcastGraphicsModeData } from '~/composables/screen/useBroadcastGraphicsModeData';
import { resolveBroadcastGraphicsRenderModel } from '~/modules/broadcast-graphics/renderModel';

const { outputMode, previewGuides, previewSafeAreas, screen } = useScreenContext();
const { graphics, onAirGraphicIds, selectedTarget, publishSelection } = useBroadcastGraphicsModeData();

const resolvedOutput = computed<ScreenOutput>(() => outputMode?.value ?? 'overlay');
const canvasDefaults = getScreenModeGraphicsCanvas('broadcast-graphics');
const canvasWidth = computed(() => screen?.value?.screenConfig?.width ?? canvasDefaults.width);
const canvasHeight = computed(() => screen?.value?.screenConfig?.height ?? canvasDefaults.height);

/**
 * Every exact Graphic Asset Revision this output may resolve.
 *
 * Deliberately derived from the whole authored stack rather than from what is on
 * air: the capability covers what the Screen publishes, and a graphic taken on air
 * must not have to wait for a fresh capability exchange before its media appears.
 */
const graphicAssetReferences = computed(() =>
	broadcastGraphicsGraphicAssetReferences({ graphics: [...graphics.value] }).map(item => item.reference),
);

// A live output resolves content only through its Screen Output Asset Capability;
// an editor preview resolves it as an author. Neither path can browse the library.
const { contentUrl } = useScreenGraphicAssetContentUrls(graphicAssetReferences);

const renderModel = computed(() => resolveBroadcastGraphicsRenderModel({
	output: resolvedOutput.value,
	canvasWidth: canvasWidth.value,
	canvasHeight: canvasHeight.value,
	graphics: graphics.value,
	onAirGraphicIds: onAirGraphicIds.value,
	itemGuides: previewGuides?.value ?? false,
	safeAreaGuides: previewSafeAreas?.value ?? false,
	selectedTarget: selectedTarget.value,
	graphicAssetContentUrl: contentUrl,
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
