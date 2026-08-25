<script setup lang="ts">
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { FeatureMatchOverlaySelectionTarget } from '~/types';
import {
	FEATURE_MATCH_SAMPLE_CONTEXT,
	FEATURE_MATCH_SAMPLE_TOKEN_VALUES,
} from '~~/shared/featureMatchSampleDataset';
import { featureMatchOverlayGraphicAssetReferences, screenGraphicAssetReferenceTargetCompatibility } from '~~/shared/utils/graphicsAssetReferences';
import { useFeatureMatchOverlayModeData } from '~/composables/screen/useFeatureMatchOverlayModeData';
import { useFeatureMatchOverlaySideboardData } from '~/composables/screen/useFeatureMatchOverlaySideboardData';
import { resolveFeatureMatchOverlayCompositorRenderModel } from '~/modules/feature-match-overlay/compositorRenderModel';
import {
	FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE,
	isFeatureMatchOverlayPreviewSelectedTargetMessage,
} from '~/modules/feature-match-overlay/previewMessages';
import { resolveFeatureMatchOverlayRenderModel } from '~/modules/feature-match-overlay/renderModel';
import { featureMatchOverlaySelectionKey } from '~/modules/feature-match-overlay/selection';
import { featureMatchGraphicsContext, featureMatchTokenValues } from '~/modules/feature-match-overlay/tokenValues';
import {
	GRAPHICS_PREVIEW_READY_MESSAGE,
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	isGraphicsPreviewSelectedTargetMessage,
} from '~/modules/graphics/previewMessages';
import FeatureMatchOverlayFrameAnimation from './FrameAnimation.vue';
import FeatureMatchOverlayFrameMedia from './FrameMedia.vue';

const { isPreview, outputMode, previewGuides, previewSafeAreas, screen } = useScreenContext();
const resolvedOutput = computed<FeatureMatchOverlayOutput>(() => outputMode?.value ?? 'overlay');
const showPreviewGuides = computed(() => previewGuides?.value ?? false);
const showSafeAreaGuides = computed(() => previewSafeAreas?.value ?? false);
const canvasWidth = computed(() => screen.value?.screenConfig?.width ?? 1920);
const canvasHeight = computed(() => screen.value?.screenConfig?.height ?? 1080);
const frameMaskId = `feature-match-overlay-frame-mask-${useId().replace(/[^\w-]/g, '')}`;
const frameGlowFilterId = `feature-match-overlay-frame-glow-${useId().replace(/[^\w-]/g, '')}`;
const { config, match, matchState, sourceMatch, round, phase, event, usesSampleDataset, loading, error } = useFeatureMatchOverlayModeData();
// Real sideboard card data for the Deck List Graphic Items (#491), fetched
// client-side while the composition authors one. A sample-dataset preview has
// no Slot and so no player ids, which is what keeps it from fetching.
const { sideboards } = useFeatureMatchOverlaySideboardData(config, match);
const indexedGraphicAssetReferences = computed(() =>
	featureMatchOverlayGraphicAssetReferences(config.value),
);
const graphicAssetReferences = computed(() => indexedGraphicAssetReferences.value.map(item => item.reference));
const videoTarget = useGraphicsVideoTarget();
const videoCompatibilityBlocked = computed(() =>
	indexedGraphicAssetReferences.value.some(reference =>
		reference.kind === 'silent-video'
		&& screenGraphicAssetReferenceTargetCompatibility(reference, videoTarget.value).outcome === 'blocked',
	));
const {
	contentUrl: graphicAssetContentUrl,
	contentRefusal: graphicAssetContentRefusal,
	contentUrlsSettled,
} = useScreenGraphicAssetContentUrls(
	graphicAssetReferences,
);

// Typography naming a library font paints in the family this registers, so the
// output stays hidden until every one of them is loaded rather than flashing a
// fallback typeface on air.
const { fontsReady, fontsFailed } = useGraphicAssetFontFaces(
	indexedGraphicAssetReferences,
	graphicAssetContentUrl,
	contentUrlsSettled,
);
const { displayTime } = useClockDisplay(() => matchState.value?.clock ?? null);
const selectedPreviewTarget = ref<FeatureMatchOverlaySelectionTarget>({ type: 'canvas' });
/**
 * The shared item tree's own selection, held separately from the host-owned one
 * for the same reason the editor holds two refs: they name things in different
 * vocabularies. Exactly one of them is ever non-canvas, because the editor clears
 * the other and pushes both back down.
 */
const selectedCompositorTarget = ref<GraphicsSelectionTarget>({ type: 'canvas' });
const renderModel = computed(() => resolveFeatureMatchOverlayRenderModel({
	config: config.value,
	output: resolvedOutput.value,
	maskId: frameMaskId,
}));

/**
 * The Feature Match Layout's shared item tree, composed by the shared compositor.
 *
 * A second render model rather than a widened first one: the two describe
 * different vocabularies, and this one is the shared compositor's own — the same
 * model a Broadcast Graphics Screen composes, resolved through the Feature Match
 * Overlay's host adapter. What it does not describe is the Frame and the Source
 * Items, which stay host-owned and are drawn by this component around it.
 *
 * Its host state is resolved once here so every Screen Output derives the same
 * frame from the same snapshot, which is what makes the Overlay, Fill, and Key
 * Outputs agree at the same authoritative time.
 */
const hostState = computed(() => ({
	event: event.value,
	featureMatch: match.value,
	matchState: matchState.value,
	sourceMatch: sourceMatch.value,
	round: round.value,
	phase: phase.value,
	displayTime: displayTime.value,
}));

const compositorRenderModel = computed(() => resolveFeatureMatchOverlayCompositorRenderModel({
	output: resolvedOutput.value,
	canvasWidth: canvasWidth.value,
	canvasHeight: canvasHeight.value,
	layout: config.value.layout,
	// A preview with no Feature Match Slot behind it shows the canonical sample
	// dataset rather than a layout of empty boxes. A live Screen Output never
	// reaches this branch, because it is never a preview.
	tokenValues: usesSampleDataset.value
		? FEATURE_MATCH_SAMPLE_TOKEN_VALUES
		: featureMatchTokenValues(hostState.value),
	featureMatch: usesSampleDataset.value
		? FEATURE_MATCH_SAMPLE_CONTEXT
		: featureMatchGraphicsContext(hostState.value, sideboards.value),
	// Editor-only, and asked for only by an embedded preview. A live Screen Output
	// never sets either flag, so no guide can reach one.
	itemGuides: showPreviewGuides.value,
	safeAreaGuides: showSafeAreaGuides.value,
	selectedTarget: selectedCompositorTarget.value,
	graphicAssetContentUrl,
	// The same resolver's other half: what it has been told this output will be
	// refused, so a clip whose recorded compatibility disagrees with its revision's
	// facts reports the reason rather than drawing a blank rectangle (#184).
	graphicAssetContentRefusal,
}));

const canvasStyle = computed(() => renderModel.value.canvasStyle);
const sourceItems = computed(() => renderModel.value.sourceItems);
const sourceCutouts = computed(() => renderModel.value.sourceCutouts);
const frameImageStyle = computed(() => renderModel.value.frame.imageStyle);
const frameImagePreserveAspectRatio = computed(() => renderModel.value.frame.imagePreserveAspectRatio);
const frameFill = computed(() => renderModel.value.frame.fill);
const frameHasGlow = computed(() => resolvedOutput.value !== 'key' && (config.value.layout.frame.glowSize ?? 0) > 0);
const frameBorderFilter = computed(() => frameHasGlow.value ? `url(#${frameGlowFilterId})` : undefined);
const frameGlowColor = computed(() => config.value.layout.frame.glowColor ?? config.value.layout.frame.borderColor ?? '#ffffff');
const frameGlowOpacity = computed(() => config.value.layout.frame.glowOpacity ?? 0.75);
const frameGlowStdDeviation = computed(() => Math.max(0.1, (config.value.layout.frame.glowSize ?? 0) / 2));
const frameHasGradient = computed(() => resolvedOutput.value !== 'key' && Boolean(config.value.layout.frame.gradient?.trim()));
const frameGradientStyle = computed(() => ({
	background: config.value.layout.frame.gradient,
	opacity: config.value.layout.frame.opacity,
}));

function borderSideEnabled(style: Parameters<typeof renderModel.value.borderSideEnabled>[0], side: Parameters<typeof renderModel.value.borderSideEnabled>[1]) {
	return renderModel.value.borderSideEnabled(style, side);
}

function guideStyle(item: { x: number; y: number; width: number; height: number }) {
	return renderModel.value.rectStyle(item);
}

function postPreviewMessage(type: typeof FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE, payload: Record<string, unknown>) {
	if (!showPreviewGuides.value || !import.meta.client)
		return;

	window.parent?.postMessage({
		type,
		...payload,
	}, window.location.origin);
}

function selectPreviewTarget(target: FeatureMatchOverlaySelectionTarget) {
	selectedPreviewTarget.value = target;
	postPreviewMessage(FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE, { target });
}

/**
 * Report a shared Graphic Item selection back to the editor that embedded this
 * preview, in the shared compositor's own vocabulary.
 *
 * Clicking empty canvas reports both surfaces, because it means "nothing is
 * selected" rather than "the compositor has nothing selected" — an author who has
 * a Source Item selected and clicks the backdrop expects it deselected too. Every
 * other click reports only the compositor: the editor clears the host-owned
 * selection itself and pushes both back down.
 */
function selectCompositorPreviewTarget(target: GraphicsSelectionTarget) {
	if (!showPreviewGuides.value)
		return;

	selectedCompositorTarget.value = target;
	if (import.meta.client)
		window.parent?.postMessage({ type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target }, window.location.origin);

	if (target.type === 'canvas')
		selectPreviewTarget({ type: 'canvas' });
}

function handleSelectedCompositorTargetMessage(message: MessageEvent) {
	if (!isGraphicsPreviewSelectedTargetMessage(message, {
		origin: window.location.origin,
		source: window.parent,
	})) {
		return;
	}

	selectedCompositorTarget.value = message.data.target;
}

function isPreviewTargetSelected(target: FeatureMatchOverlaySelectionTarget) {
	return featureMatchOverlaySelectionKey(selectedPreviewTarget.value) === featureMatchOverlaySelectionKey(target);
}

function handleSelectedPreviewTargetMessage(message: MessageEvent) {
	if (!isFeatureMatchOverlayPreviewSelectedTargetMessage(message, {
		origin: window.location.origin,
		source: window.parent,
	})) {
		return;
	}

	selectedPreviewTarget.value = message.data.target;
}

/**
 * Tell the editor that embedded this preview that it can now be spoken to.
 *
 * The editor's other channel is the iframe's own `load` event, and that is not
 * the moment this frame can be pushed into: the application renders on the
 * client, so `load` fires when the shell and its scripts have arrived, while
 * these listeners are installed when the app mounts — afterwards, and by an
 * amount neither side controls. A push that lost that race was dropped in
 * silence and left the preview rendering the Screen's *stored* configuration
 * rather than the working one (#235).
 *
 * It belongs here rather than in `useFeatureMatchOverlayModeData`, which is
 * where the Broadcast Graphics side announces from, because this frame's
 * listeners are split across the two: the composable takes the configuration
 * push and this component takes both selections. Announcing from the composable
 * would promise a full push one mount hook before the selections could be
 * received.
 *
 * Gated on being a preview rather than on the guides switch, for the same reason
 * the configuration override is: whether an author is looking at item guides has
 * nothing to do with whether the frame has an editor behind it. And only when
 * there is somebody to tell — a preview URL opened in its own tab is its own
 * `window.parent`, and would otherwise announce itself to itself.
 */
function announcePreviewReady() {
	if (!isPreview?.value || !import.meta.client || window.parent === window)
		return;

	window.parent?.postMessage({ type: GRAPHICS_PREVIEW_READY_MESSAGE }, window.location.origin);
}

/**
 * Both selection listeners exist to hear one window: the editor that embedded
 * this frame. A live Screen Output has no editor behind it — and `window.parent`
 * there is the output's own window — so the sender check every one of these
 * guards is built on stops nothing at all on a live output, and a same-origin
 * embedder or an in-page script could set the selection state (#259).
 *
 * Gated at the registration rather than inside each handler, on the same ground
 * as the announcement above: whether this frame has an editor behind it is a
 * property of the frame, not of a message, and reading it here settles it once
 * for both listeners instead of asking every handler a future edit adds to
 * remember. A live output then installs no `message` listener of its own at all,
 * which is a stronger statement than each handler declining to act.
 *
 * The write it closes is dead today — the guide layer is gated on
 * `showPreviewGuides`, and the render model passes `itemGuides: false` on a live
 * output, so nothing drawn there reads either selection — but "nothing renders
 * it yet" is a property of consumers this component does not own, and the pins
 * on this are written so the gate holds whatever a future consumer does.
 */
onMounted(() => {
	if (isPreview?.value) {
		window.addEventListener('message', handleSelectedPreviewTargetMessage);
		window.addEventListener('message', handleSelectedCompositorTargetMessage);
	}
	announcePreviewReady();
});

// Unconditional on purpose: removing a listener that was never added is a no-op,
// while re-reading `isPreview` here would leave one installed for good if it had
// changed since the mount.
onBeforeUnmount(() => {
	window.removeEventListener('message', handleSelectedPreviewTargetMessage);
	window.removeEventListener('message', handleSelectedCompositorTargetMessage);
});
</script>

<template>
	<div
		class="feature-match-overlay"
		:class="`feature-match-overlay--${resolvedOutput}`"
		:style="{ ...canvasStyle, visibility: fontsReady ? undefined : 'hidden' }"
		:data-export-ready="(!loading && !error && !videoCompatibilityBlocked && fontsReady && !fontsFailed).toString()"
		:data-font-ready="fontsReady.toString()"
		:data-font-error="fontsFailed.toString()"
	>
		<svg
			class="frame-layer"
			width="100%"
			height="100%"
			:viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<defs>
				<mask
					:id="frameMaskId"
					maskUnits="userSpaceOnUse"
					x="0"
					y="0"
					:width="canvasWidth"
					:height="canvasHeight"
				>
					<rect
						x="0"
						y="0"
						:width="canvasWidth"
						:height="canvasHeight"
						fill="white"
					/>
					<path
						v-for="cutout in sourceCutouts"
						:key="`cutout-${cutout.id}`"
						:d="cutout.path"
						fill="black"
					/>
				</mask>
				<filter
					v-if="frameHasGlow"
					:id="frameGlowFilterId"
					x="-20%"
					y="-20%"
					width="140%"
					height="140%"
				>
					<feDropShadow
						dx="0"
						dy="0"
						:stdDeviation="frameGlowStdDeviation"
						:flood-color="frameGlowColor"
						:flood-opacity="frameGlowOpacity"
					/>
				</filter>
			</defs>
			<rect
				x="0"
				y="0"
				:width="canvasWidth"
				:height="canvasHeight"
				:fill="frameFill"
				:opacity="config.layout.frame.opacity"
				:mask="`url(#${frameMaskId})`"
			/>
			<FeatureMatchOverlayFrameMedia
				:media="config.layout.frame.mediaBackground"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				:mask-id="frameMaskId"
				:output="resolvedOutput"
			/>
			<image
				v-if="resolvedOutput !== 'key' && config.layout.frame.backgroundImage"
				:xlink:href="graphicAssetContentUrl(config.layout.frame.backgroundImage)"
				x="0"
				y="0"
				:width="canvasWidth"
				:height="canvasHeight"
				:preserveAspectRatio="frameImagePreserveAspectRatio"
				:mask="`url(#${frameMaskId})`"
				:style="frameImageStyle"
			/>
			<foreignObject
				v-if="frameHasGradient"
				x="0"
				y="0"
				:width="canvasWidth"
				:height="canvasHeight"
				:mask="`url(#${frameMaskId})`"
			>
				<div
					xmlns="http://www.w3.org/1999/xhtml"
					class="frame-gradient"
					:style="frameGradientStyle"
				/>
			</foreignObject>
			<FeatureMatchOverlayFrameAnimation
				:animation="config.layout.frame.animation"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				:mask-id="frameMaskId"
				:output="resolvedOutput"
			/>
			<g
				v-if="config.layout.frame.borderVisible"
				:stroke="resolvedOutput === 'key' ? '#fff' : config.layout.frame.borderColor"
				:stroke-width="config.layout.frame.borderWidth"
				:filter="frameBorderFilter"
			>
				<line
					v-if="borderSideEnabled(config.layout.frame, 'Top')"
					x1="0"
					y1="0"
					:x2="canvasWidth"
					y2="0"
				/>
				<line
					v-if="borderSideEnabled(config.layout.frame, 'Right')"
					:x1="canvasWidth"
					y1="0"
					:x2="canvasWidth"
					:y2="canvasHeight"
				/>
				<line
					v-if="borderSideEnabled(config.layout.frame, 'Bottom')"
					x1="0"
					:y1="canvasHeight"
					:x2="canvasWidth"
					:y2="canvasHeight"
				/>
				<line
					v-if="borderSideEnabled(config.layout.frame, 'Left')"
					x1="0"
					y1="0"
					x2="0"
					:y2="canvasHeight"
				/>
			</g>
		</svg>

		<div
			v-for="source in sourceItems"
			:key="source.item.id"
			:data-graphic-item-id="source.item.id"
			:style="source.style"
		/>

		<!--
			The Feature Match Layout's shared item tree, above the Frame and the Source
			Items because the Frame is the continuous area that sits behind and around
			everything else. The compositor owns the whole of what is inside this
			element; the Frame around it, and the cutouts through it, are host-owned.
		-->
		<GraphicsCompositorCanvas
			class="feature-match-overlay__composition"
			:render="compositorRenderModel"
		/>

		<!--
			One guide layer over one canvas, drawn by the host that paints the canvas.
			The shared compositor's guides come from its own render model; the Frame's
			Source Items are host-owned and drawn here, above them, so a Source Item
			stays selectable where the two overlap.
		-->
		<GraphicsCompositorGuideLayer
			:item-guides="compositorRenderModel.itemGuides"
			:safe-area-guides="compositorRenderModel.safeAreaGuides"
			:selectable-canvas="showPreviewGuides"
			@select="selectCompositorPreviewTarget"
		>
			<template v-if="showPreviewGuides">
				<div
					v-for="source in sourceItems"
					:key="`source-guide-${source.item.id}`"
					class="graphic-item-guide graphic-item-guide--source"
					:class="{ 'is-selected': isPreviewTargetSelected({ type: 'source', itemId: source.item.id }) }"
					:style="guideStyle(source.item)"
					role="button"
					tabindex="0"
					:aria-label="`Select ${source.item.label}`"
					@click.stop="selectPreviewTarget({ type: 'source', itemId: source.item.id })"
					@keydown.enter.stop="selectPreviewTarget({ type: 'source', itemId: source.item.id })"
					@keydown.space.prevent.stop="selectPreviewTarget({ type: 'source', itemId: source.item.id })"
				>
					<span>{{ source.item.label }}</span>
				</div>
			</template>
		</GraphicsCompositorGuideLayer>
	</div>
</template>

<style scoped>
.feature-match-overlay {
	isolation: isolate;
}

.frame-layer {
	position: absolute;
	inset: 0;
}

/*
 * The shared compositor fills the canvas and composes itself; it is placed here
 * rather than sized by its own model because the canvas coordinate space belongs
 * to the Screen, and the Frame around it is drawn in the same space.
 */
.feature-match-overlay__composition {
	position: absolute;
	inset: 0;
}

.frame-gradient {
	width: 100%;
	height: 100%;
}

/*
 * The host-owned guides slotted into the shared guide layer. The layer itself,
 * its canvas catch-all, and the shared item guides are the compositor's; these
 * are the Frame's Source Items, which have no shared vocabulary and so keep
 * their own colour.
 */
.graphic-item-guide {
	position: absolute;
	box-sizing: border-box;
	border: 2px dashed rgba(255, 255, 255, 0.9);
	background: rgba(0, 119, 163, 0.08);
	box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.55);
	cursor: pointer;
}

.graphic-item-guide--source {
	border-color: rgba(56, 189, 248, 0.95);
}

.graphic-item-guide span {
	position: absolute;
	left: 0;
	top: 0;
	max-width: 100%;
	padding: 2px 6px;
	background: rgba(0, 0, 0, 0.75);
	color: #fff;
	font-size: 12px;
	line-height: 1.2;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.graphic-item-guide.is-selected {
	border-style: solid;
	border-color: #fff;
	background: rgba(255, 255, 255, 0.18);
	box-shadow:
		0 0 0 2px rgba(0, 0, 0, 0.7),
		0 0 0 5px rgba(59, 130, 246, 0.95),
		inset 0 0 0 1px rgba(0, 0, 0, 0.55);
}
</style>
