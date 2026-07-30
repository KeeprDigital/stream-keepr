<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { getScreenModeGraphicsCanvas } from '~~/shared/screenModes';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import GraphicsCompositorCanvas from '~/components/Graphics/Compositor/Canvas.vue';
import { useBroadcastGraphicsModeData } from '~/composables/screen/useBroadcastGraphicsModeData';
import { resolveBroadcastGraphicsRenderModel } from '~/modules/broadcast-graphics/renderModel';

const { outputMode, previewGuides, previewSafeAreas, screen } = useScreenContext();
const {
	graphics,
	onAirGraphicIds,
	inputValues,
	isAuthoringPreview,
	selectedTarget,
	publishSelection,
} = useBroadcastGraphicsModeData();

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
 *
 * Rebuilt freely on any stack change. `useScreenGraphicAssetContentUrls` keys its
 * resolution on the *set* of revisions rather than on this array's identity, so an
 * edit that pins nothing new does not re-resolve — which is what keeps an on-air
 * video from being torn down and restarted mid-air.
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
	inputValues: inputValues.value,
	// An author sees unset Graphic Inputs as their authored defaults; a live output
	// shows nothing for them rather than putting placeholder text on program.
	substituteAuthoredDefaults: isAuthoringPreview.value,
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
