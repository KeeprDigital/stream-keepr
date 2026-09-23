<script setup lang="ts">
import type { AnimationEffectRenderPlan } from '~~/shared/animationEffects';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { animationEffectRenderPlan } from '~~/shared/animationEffects';
import { getScreenModeGraphicsCanvas } from '~~/shared/screenModes';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import GraphicsCompositorCanvas from '~/components/Graphics/Compositor/Canvas.vue';
import { useBroadcastGraphicsModeData } from '~/composables/screen/useBroadcastGraphicsModeData';
import { resolveBroadcastGraphicsRenderModel } from '~/modules/broadcast-graphics/renderModel';

const { outputMode, previewGuides, previewSafeAreas, screen } = useScreenContext();
const {
	animationProjection,
	background,
	graphics,
	onAirGraphicIds,
	inputValues,
	outgoingInputValues,
	socialProfileValues,
	outgoingSocialProfileValues,
	socialProfilePresentations,
	outgoingSocialProfilePresentations,
	isAuthoringPreview,
	selectedTarget,
	publishSelection,
} = useBroadcastGraphicsModeData();

const resolvedOutput = computed<ScreenOutput>(() => outputMode?.value ?? 'overlay');

/**
 * The Broadcast Graphics Background this output paints behind its stack, or
 * nothing.
 *
 * Never in the Key Output: that output is an alpha matte, in which every painted
 * element is pure white at its own alpha over black, and an Animation Effect is
 * neither — the rule the Feature Match Overlay Frame's animation already follows.
 * Whether this is an authoring preview is decided upstream, where the preview
 * state lives.
 */
const backgroundPlan = computed<AnimationEffectRenderPlan & { opacity: number } | null>(() => {
	const config = background.value;
	if (!config || !config.enabled || resolvedOutput.value === 'key')
		return null;
	return { ...animationEffectRenderPlan(config), opacity: config.opacity };
});
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
const indexedGraphicAssetReferences = computed(() =>
	broadcastGraphicsGraphicAssetReferences({ graphics: [...graphics.value] }),
);
const graphicAssetReferences = computed(() =>
	indexedGraphicAssetReferences.value.map(item => item.reference),
);

// A live output resolves content only through its Screen Output Asset Capability;
// an editor preview resolves it as an author. Neither path can browse the library.
const { contentUrl, contentRefusal, contentUrlsSettled } = useScreenGraphicAssetContentUrls(graphicAssetReferences);

// Typography naming a library font paints in the family this registers, so the
// canvas stays hidden until every one of them is loaded rather than flashing a
// fallback typeface on air.
const { fontsReady, fontsFailed, fontSources } = useGraphicAssetFontFaces(
	indexedGraphicAssetReferences,
	contentUrl,
	contentUrlsSettled,
);

const renderModel = computed(() => resolveBroadcastGraphicsRenderModel({
	output: resolvedOutput.value,
	canvasWidth: canvasWidth.value,
	canvasHeight: canvasHeight.value,
	graphics: graphics.value,
	onAirGraphicIds: onAirGraphicIds.value,
	animation: animationProjection.value,
	inputValues: inputValues.value,
	outgoingInputValues: outgoingInputValues.value,
	socialProfileValues: socialProfileValues.value,
	outgoingSocialProfileValues: outgoingSocialProfileValues.value,
	socialProfilePresentations: socialProfilePresentations.value,
	outgoingSocialProfilePresentations: outgoingSocialProfilePresentations.value,
	// An author sees unset Graphic Inputs as their authored defaults; a live output
	// shows nothing for them rather than putting placeholder text on program.
	substituteAuthoredDefaults: isAuthoringPreview.value,
	itemGuides: previewGuides?.value ?? false,
	safeAreaGuides: previewSafeAreas?.value ?? false,
	selectedTarget: selectedTarget.value,
	graphicAssetContentUrl: contentUrl,
	// The same resolver's other half: what it has been told this output will be
	// refused, so a clip whose recorded compatibility disagrees with its revision's
	// facts reports the reason rather than drawing a blank rectangle (#184).
	graphicAssetContentRefusal: contentRefusal,
}));
</script>

<template>
	<GraphicsCompositorCanvas
		class="broadcast-graphics"
		:class="`broadcast-graphics--${renderModel.output}`"
		:style="{ visibility: fontsReady ? undefined : 'hidden' }"
		:data-font-ready="fontsReady.toString()"
		:data-font-error="fontsFailed.toString()"
		:data-export-font-sources="JSON.stringify(fontSources)"
		:render="renderModel"
		@select="publishSelection"
	>
		<template v-if="backgroundPlan" #backdrop>
			<div
				class="broadcast-graphics__background"
				data-testid="broadcast-graphics-background"
				:style="{ opacity: backgroundPlan.opacity }"
			>
				<ScreenAnimationEffectSurface
					:effect="backgroundPlan.effect"
					:params="backgroundPlan.params"
					:width="canvasWidth"
					:height="canvasHeight"
				/>
			</div>
		</template>
	</GraphicsCompositorCanvas>
</template>

<style scoped>
.broadcast-graphics__background {
	position: absolute;
	inset: 0;
}
</style>
