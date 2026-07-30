<script setup lang="ts">
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayGraphicGroupChildRenderModel } from '~/modules/feature-match-overlay/renderModel';
import type { FeatureMatchOverlaySelectionTarget } from '~/types';
import { graphicAssetFontFaceFamily } from '~~/shared/featureMatchOverlayFonts';
import { featureMatchOverlayGraphicAssetReferences, screenGraphicAssetReferenceTargetCompatibility } from '~~/shared/utils/graphicsAssetReferences';
import { useFeatureMatchOverlayModeData } from '~/composables/screen/useFeatureMatchOverlayModeData';
import { resolveFeatureMatchOverlayRenderModel } from '~/modules/feature-match-overlay/renderModel';
import { featureMatchOverlaySelectionKey, isFeatureMatchOverlaySelectionTarget } from '~/modules/feature-match-overlay/selection';
import { createGuardedSequence } from '~/utils/guardedSequence';
import FeatureMatchOverlayFrameAnimation from './FrameAnimation.vue';
import FeatureMatchOverlayFrameMedia from './FrameMedia.vue';
import FeatureMatchOverlayMediaGraphicItem from './MediaGraphicItem.vue';
import FeatureMatchOverlayGraphicItem from './Widget.vue';

const { outputMode, previewGuides, screen } = useScreenContext();
const resolvedOutput = computed<FeatureMatchOverlayOutput>(() => outputMode?.value ?? 'overlay');
const showPreviewGuides = computed(() => previewGuides?.value ?? false);
const canvasWidth = computed(() => screen.value?.screenConfig?.width ?? 1920);
const canvasHeight = computed(() => screen.value?.screenConfig?.height ?? 1080);
const frameMaskId = `feature-match-overlay-frame-mask-${useId().replace(/[^\w-]/g, '')}`;
const frameGlowFilterId = `feature-match-overlay-frame-glow-${useId().replace(/[^\w-]/g, '')}`;
const { config, match, matchState, sourceMatch, round, phase, event, loading, error } = useFeatureMatchOverlayModeData();
const indexedGraphicAssetReferences = computed(() =>
	featureMatchOverlayGraphicAssetReferences(config.value),
);
const graphicAssetReferences = computed(() => indexedGraphicAssetReferences.value.map(item => item.reference));
const fontAssetReferences = computed(() =>
	indexedGraphicAssetReferences.value
		.filter(item => item.kind === 'font')
		.map(item => item.reference),
);
const videoTarget = useGraphicsVideoTarget();
const videoCompatibilityBlocked = computed(() =>
	indexedGraphicAssetReferences.value.some(reference =>
		reference.kind === 'silent-video'
		&& screenGraphicAssetReferenceTargetCompatibility(reference, videoTarget.value).outcome === 'blocked',
	));
const {
	contentUrl: graphicAssetContentUrl,
	contentUrlsSettled,
} = useScreenGraphicAssetContentUrls(
	graphicAssetReferences,
);
const fontAssetSources = computed(() => ({
	settled: contentUrlsSettled.value,
	sources: Array.from(new Map(fontAssetReferences.value.map(reference => [
		graphicAssetFontFaceFamily(reference),
		{
			reference,
			family: graphicAssetFontFaceFamily(reference),
			url: graphicAssetContentUrl(reference),
		},
	])).values()),
}));
const { displayTime } = useClockDisplay(() => matchState.value?.clock ?? null);
const selectedPreviewTarget = ref<FeatureMatchOverlaySelectionTarget>({ type: 'canvas' });
const fontReady = ref(true);
const fontError = ref(false);
let loadedFontFaces: FontFace[] = [];
const fontLoads = createGuardedSequence();

function discardFontFaces(faces: readonly FontFace[]) {
	for (const face of faces)
		document.fonts.delete(face);
}

watch(fontAssetSources, async ({ settled, sources }) => {
	const flight = fontLoads.begin();
	fontReady.value = sources.length === 0;
	fontError.value = false;
	if (!import.meta.client)
		return;
	discardFontFaces(loadedFontFaces);
	loadedFontFaces = [];
	if (sources.length === 0)
		return;
	if (!settled)
		return;
	const faces: FontFace[] = [];
	try {
		for (const { family, url } of sources) {
			if (!url)
				throw new Error('Exact font revision content is unavailable.');
			const face = new FontFace(family, `url("${url.replaceAll('"', '%22')}")`);
			faces.push(face);
			document.fonts.add(face);
			await face.load();
			if (flight.stale) {
				discardFontFaces(faces);
				return;
			}
			await document.fonts.load(`48px "${family}"`, 'Aa 012 Player Name');
			if (flight.stale) {
				discardFontFaces(faces);
				return;
			}
			if (!document.fonts.check(`48px "${family}"`, 'Aa 012 Player Name'))
				throw new Error('Exact font revision is not ready.');
		}
		await document.fonts.ready;
		if (flight.stale) {
			discardFontFaces(faces);
			return;
		}
		loadedFontFaces = faces;
		fontReady.value = true;
	}
	catch {
		discardFontFaces(faces);
		if (flight.current)
			fontError.value = true;
	}
}, { immediate: true });

const renderModel = computed(() => resolveFeatureMatchOverlayRenderModel({
	config: config.value,
	output: resolvedOutput.value,
	canvasWidth: canvasWidth.value,
	canvasHeight: canvasHeight.value,
	displayTime: displayTime.value,
	event: event.value,
	featureMatch: match.value,
	sourceMatch: sourceMatch.value,
	round: round.value,
	phase: phase.value,
	matchState: matchState.value,
	maskId: frameMaskId,
	graphicAssetContentPath: graphicAssetContentUrl,
}));

const canvasStyle = computed(() => renderModel.value.canvasStyle);
const layoutItems = computed(() => renderModel.value.layoutItems);
const sourceItems = computed(() => renderModel.value.sourceItems);
const mediaItems = computed(() => renderModel.value.mediaItems);
const graphicItemItems = computed(() => renderModel.value.graphicItemItems);
const graphicGroups = computed(() => renderModel.value.graphicGroups);
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

function numericStyleValue(value: unknown) {
	if (typeof value === 'number')
		return value;
	if (typeof value !== 'string')
		return 0;
	return Number.parseFloat(value) || 0;
}

function childGuideStyle(group: { x: number; y: number }, child: FeatureMatchOverlayGraphicGroupChildRenderModel) {
	return {
		left: `${group.x + numericStyleValue(child.style.left)}px`,
		top: `${group.y + numericStyleValue(child.style.top)}px`,
		width: `${numericStyleValue(child.style.width)}px`,
		height: `${numericStyleValue(child.style.height)}px`,
	};
}

function postPreviewMessage(type: 'feature-match-overlay:select', payload: Record<string, unknown>) {
	if (!showPreviewGuides.value || !import.meta.client)
		return;

	window.parent?.postMessage({
		type,
		...payload,
	}, window.location.origin);
}

function selectPreviewTarget(target: FeatureMatchOverlaySelectionTarget) {
	selectedPreviewTarget.value = target;
	postPreviewMessage('feature-match-overlay:select', { target });
}

function isPreviewTargetSelected(target: FeatureMatchOverlaySelectionTarget) {
	return featureMatchOverlaySelectionKey(selectedPreviewTarget.value) === featureMatchOverlaySelectionKey(target);
}

function isPreviewTargetMessage(message: MessageEvent): message is MessageEvent<{ type: 'feature-match-overlay:selected-target'; target: FeatureMatchOverlaySelectionTarget }> {
	return message.origin === window.location.origin
		&& message.source === window.parent
		&& typeof message.data === 'object'
		&& message.data !== null
		&& message.data.type === 'feature-match-overlay:selected-target'
		&& isFeatureMatchOverlaySelectionTarget(message.data.target);
}

function handleSelectedPreviewTargetMessage(message: MessageEvent) {
	if (!isPreviewTargetMessage(message))
		return;

	selectedPreviewTarget.value = message.data.target;
}

onMounted(() => {
	window.addEventListener('message', handleSelectedPreviewTargetMessage);
});

onBeforeUnmount(() => {
	window.removeEventListener('message', handleSelectedPreviewTargetMessage);
	fontLoads.supersede();
	discardFontFaces(loadedFontFaces);
});
</script>

<template>
	<div
		class="feature-match-overlay"
		:class="`feature-match-overlay--${resolvedOutput}`"
		:style="{ ...canvasStyle, visibility: fontReady ? undefined : 'hidden' }"
		:data-export-ready="(!loading && !error && fontReady && !fontError && !videoCompatibilityBlocked).toString()"
		:data-font-ready="fontReady.toString()"
		:data-font-error="fontError.toString()"
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

		<template v-for="layoutItem in layoutItems" :key="layoutItem.item.id">
			<div
				v-if="layoutItem.kind === 'source'"
				:data-graphic-item-id="layoutItem.item.id"
				:style="layoutItem.style"
			/>
			<FeatureMatchOverlayMediaGraphicItem
				v-else-if="layoutItem.kind === 'media'"
				:data-graphic-item-id="layoutItem.item.id"
				:media="layoutItem"
			/>
			<div
				v-else-if="layoutItem.kind === 'graphic-item'"
				:data-graphic-item-id="layoutItem.item.id"
				:style="layoutItem.style"
			>
				<FeatureMatchOverlayGraphicItem :render="layoutItem.render" :output="resolvedOutput" />
			</div>
			<div
				v-else
				class="feature-match-overlay-graphic-group"
				:data-graphic-item-id="layoutItem.item.id"
				:style="layoutItem.layers.shell"
			>
				<div class="feature-match-overlay-graphic-group__backdrop" :style="layoutItem.layers.backdrop" aria-hidden="true" />
				<div class="feature-match-overlay-graphic-group__children" :style="layoutItem.layers.children">
					<template
						v-for="child in layoutItem.children"
						:key="child.id"
					>
						<FeatureMatchOverlayMediaGraphicItem
							v-if="child.kind === 'media'"
							class="feature-match-overlay-graphic-group__child"
							:media="child"
						/>
						<div
							v-else
							class="feature-match-overlay-graphic-group__child"
							:style="child.style"
						>
							<FeatureMatchOverlayGraphicItem :render="child.render" :output="resolvedOutput" />
						</div>
					</template>
				</div>
				<div class="feature-match-overlay-graphic-group__frame" :style="layoutItem.layers.frame" aria-hidden="true" />
			</div>
		</template>

		<div v-if="showPreviewGuides" class="guide-layer" aria-label="Feature Match Overlay editor selection layer">
			<button
				type="button"
				class="canvas-guide"
				aria-label="Select canvas"
				@click.stop="selectPreviewTarget({ type: 'canvas' })"
			/>
			<div
				v-for="source in sourceItems"
				:key="`source-guide-${source.item.id}`"
				class="graphic-item-guide graphic-item-guide--source"
				:class="{ 'is-selected': isPreviewTargetSelected({ type: 'layer', itemId: source.item.id }) }"
				:style="guideStyle(source.item)"
				role="button"
				tabindex="0"
				:aria-label="`Select ${source.item.label}`"
				@click.stop="selectPreviewTarget({ type: 'layer', itemId: source.item.id })"
				@keydown.enter.stop="selectPreviewTarget({ type: 'layer', itemId: source.item.id })"
				@keydown.space.prevent.stop="selectPreviewTarget({ type: 'layer', itemId: source.item.id })"
			>
				<span>{{ source.item.label }}</span>
			</div>
			<div
				v-for="graphicItem in graphicItemItems"
				:key="`graphicItem-guide-${graphicItem.id}`"
				class="graphic-item-guide graphic-item-guide--graphicItem"
				:class="{ 'is-selected': isPreviewTargetSelected({ type: 'layer', itemId: graphicItem.item.id }) }"
				:style="guideStyle(graphicItem.item)"
				role="button"
				tabindex="0"
				:aria-label="`Select ${graphicItem.label}`"
				@click.stop="selectPreviewTarget({ type: 'layer', itemId: graphicItem.item.id })"
				@keydown.enter.stop="selectPreviewTarget({ type: 'layer', itemId: graphicItem.item.id })"
				@keydown.space.prevent.stop="selectPreviewTarget({ type: 'layer', itemId: graphicItem.item.id })"
			>
				<span>{{ graphicItem.label }}</span>
			</div>
			<div
				v-for="media in mediaItems"
				:key="`media-guide-${media.item.id}`"
				class="graphic-item-guide graphic-item-guide--media"
				:class="{ 'is-selected': isPreviewTargetSelected({ type: 'layer', itemId: media.item.id }) }"
				:style="guideStyle(media.item)"
				role="button"
				tabindex="0"
				:aria-label="`Select ${media.item.label}`"
				@click.stop="selectPreviewTarget({ type: 'layer', itemId: media.item.id })"
			>
				<span>{{ media.item.label }}</span>
			</div>
			<div
				v-for="group in graphicGroups"
				:key="`group-guide-${group.item.id}`"
				class="graphic-item-guide graphic-item-guide--group"
				:class="{ 'is-selected': isPreviewTargetSelected({ type: 'layer', itemId: group.item.id }) }"
				:style="guideStyle(group.item)"
				role="button"
				tabindex="0"
				:aria-label="`Select ${group.item.label}`"
				@click.stop="selectPreviewTarget({ type: 'layer', itemId: group.item.id })"
				@keydown.enter.stop="selectPreviewTarget({ type: 'layer', itemId: group.item.id })"
				@keydown.space.prevent.stop="selectPreviewTarget({ type: 'layer', itemId: group.item.id })"
			>
				<span>{{ group.item.label }}</span>
			</div>
			<template v-for="group in graphicGroups" :key="`group-graphicItem-guides-${group.item.id}`">
				<div
					v-for="child in group.children"
					:key="`child-guide-${group.item.id}-${child.id}`"
					class="graphic-item-guide graphic-item-guide--child"
					:class="{ 'is-selected': isPreviewTargetSelected({ type: 'graphic-item', itemId: group.item.id, childId: child.id }) }"
					:style="childGuideStyle(group.item, child)"
					role="button"
					tabindex="0"
					:aria-label="`Select ${child.label}`"
					@click.stop="selectPreviewTarget({ type: 'graphic-item', itemId: group.item.id, childId: child.id })"
					@keydown.enter.stop="selectPreviewTarget({ type: 'graphic-item', itemId: group.item.id, childId: child.id })"
					@keydown.space.prevent.stop="selectPreviewTarget({ type: 'graphic-item', itemId: group.item.id, childId: child.id })"
				>
					<span>{{ child.label }}</span>
				</div>
			</template>
		</div>
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

.frame-gradient {
	width: 100%;
	height: 100%;
}

.guide-layer {
	position: absolute;
	inset: 0;
	pointer-events: auto;
	z-index: 999;
}

.canvas-guide {
	position: absolute;
	inset: 0;
	border: 0;
	background: transparent;
	cursor: default;
}

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

.graphic-item-guide--graphicItem {
	border-color: rgba(250, 204, 21, 0.95);
}

.graphic-item-guide--group {
	border-color: rgba(34, 197, 94, 0.95);
}

.graphic-item-guide--child {
	border-color: rgba(168, 85, 247, 0.95);
	background: rgba(168, 85, 247, 0.12);
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
