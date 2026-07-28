<script setup lang="ts">
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayWidgetRenderDescriptor } from '~/modules/feature-match-overlay/renderModel';
import type { FeatureMatchOverlaySelectionTarget } from '~/types';
import { featureMatchOverlayGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import { useFeatureMatchOverlayModeData } from '~/composables/screen/useFeatureMatchOverlayModeData';
import { resolveFeatureMatchOverlayRenderModel } from '~/modules/feature-match-overlay/renderModel';
import { featureMatchOverlaySelectionKey, isFeatureMatchOverlaySelectionTarget } from '~/modules/feature-match-overlay/selection';
import FeatureMatchOverlayFrameAnimation from './FrameAnimation.vue';
import FeatureMatchOverlayFrameMedia from './FrameMedia.vue';
import FeatureMatchOverlayWidget from './Widget.vue';

const { outputMode, previewGuides, screen } = useScreenContext();
const resolvedOutput = computed<FeatureMatchOverlayOutput>(() => outputMode?.value ?? 'overlay');
const showPreviewGuides = computed(() => previewGuides?.value ?? false);
const canvasWidth = computed(() => screen.value?.screenConfig?.width ?? 1920);
const canvasHeight = computed(() => screen.value?.screenConfig?.height ?? 1080);
const frameMaskId = `feature-match-overlay-frame-mask-${useId().replace(/[^\w-]/g, '')}`;
const frameGlowFilterId = `feature-match-overlay-frame-glow-${useId().replace(/[^\w-]/g, '')}`;
const { config, match, matchState, sourceMatch, round, phase, event, loading, error } = useFeatureMatchOverlayModeData();
const graphicAssetReferences = computed(() =>
	featureMatchOverlayGraphicAssetReferences(config.value).map(item => item.reference),
);
const { contentUrl: graphicAssetContentUrl } = useScreenGraphicAssetContentUrls(
	graphicAssetReferences,
);
const { displayTime } = useClockDisplay(() => matchState.value?.clock ?? null);
const selectedPreviewTarget = ref<FeatureMatchOverlaySelectionTarget>({ type: 'canvas' });

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
const sourceItems = computed(() => renderModel.value.sourceItems);
const widgetItems = computed(() => renderModel.value.widgetItems);
const widgetGroups = computed(() => renderModel.value.widgetGroups);
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

function childGuideStyle(group: { x: number; y: number }, child: FeatureMatchOverlayWidgetRenderDescriptor) {
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
});
</script>

<template>
	<div
		class="feature-match-overlay"
		:class="`feature-match-overlay--${resolvedOutput}`"
		:style="canvasStyle"
		:data-export-ready="(!loading && !error).toString()"
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

		<div v-for="source in sourceItems" :key="source.item.id" :style="source.style" />

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
				class="region-guide region-guide--source"
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
				v-for="widget in widgetItems"
				:key="`widget-guide-${widget.id}`"
				class="region-guide region-guide--widget"
				:class="{ 'is-selected': isPreviewTargetSelected({ type: 'layer', itemId: widget.item.id }) }"
				:style="guideStyle(widget.item)"
				role="button"
				tabindex="0"
				:aria-label="`Select ${widget.label}`"
				@click.stop="selectPreviewTarget({ type: 'layer', itemId: widget.item.id })"
				@keydown.enter.stop="selectPreviewTarget({ type: 'layer', itemId: widget.item.id })"
				@keydown.space.prevent.stop="selectPreviewTarget({ type: 'layer', itemId: widget.item.id })"
			>
				<span>{{ widget.label }}</span>
			</div>
			<div
				v-for="group in widgetGroups"
				:key="`group-guide-${group.item.id}`"
				class="region-guide region-guide--group"
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
			<template v-for="group in widgetGroups" :key="`group-widget-guides-${group.item.id}`">
				<div
					v-for="child in group.children"
					:key="`child-guide-${group.item.id}-${child.id}`"
					class="region-guide region-guide--child"
					:class="{ 'is-selected': isPreviewTargetSelected({ type: 'widget', itemId: group.item.id, childId: child.id }) }"
					:style="childGuideStyle(group.item, child)"
					role="button"
					tabindex="0"
					:aria-label="`Select ${child.label}`"
					@click.stop="selectPreviewTarget({ type: 'widget', itemId: group.item.id, childId: child.id })"
					@keydown.enter.stop="selectPreviewTarget({ type: 'widget', itemId: group.item.id, childId: child.id })"
					@keydown.space.prevent.stop="selectPreviewTarget({ type: 'widget', itemId: group.item.id, childId: child.id })"
				>
					<span>{{ child.label }}</span>
				</div>
			</template>
		</div>

		<template v-for="widget in widgetItems" :key="widget.id">
			<div :style="widget.style">
				<FeatureMatchOverlayWidget :render="widget.render" :output="resolvedOutput" />
			</div>
		</template>

		<div
			v-for="group in widgetGroups"
			:key="group.item.id"
			class="feature-match-overlay-widget-group"
			:style="group.layers.shell"
		>
			<div class="feature-match-overlay-widget-group__backdrop" :style="group.layers.backdrop" aria-hidden="true" />
			<div class="feature-match-overlay-widget-group__children" :style="group.layers.children">
				<div
					v-for="child in group.children"
					:key="child.id"
					class="feature-match-overlay-widget-group__child"
					:style="child.style"
				>
					<FeatureMatchOverlayWidget :render="child.render" :output="resolvedOutput" />
				</div>
			</div>
			<div class="feature-match-overlay-widget-group__frame" :style="group.layers.frame" aria-hidden="true" />
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

.region-guide {
	position: absolute;
	box-sizing: border-box;
	border: 2px dashed rgba(255, 255, 255, 0.9);
	background: rgba(0, 119, 163, 0.08);
	box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.55);
	cursor: pointer;
}

.region-guide--source {
	border-color: rgba(56, 189, 248, 0.95);
}

.region-guide--widget {
	border-color: rgba(250, 204, 21, 0.95);
}

.region-guide--group {
	border-color: rgba(34, 197, 94, 0.95);
}

.region-guide--child {
	border-color: rgba(168, 85, 247, 0.95);
	background: rgba(168, 85, 247, 0.12);
}

.region-guide span {
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

.region-guide.is-selected {
	border-style: solid;
	border-color: #fff;
	background: rgba(255, 255, 255, 0.18);
	box-shadow:
		0 0 0 2px rgba(0, 0, 0, 0.7),
		0 0 0 5px rgba(59, 130, 246, 0.95),
		inset 0 0 0 1px rgba(0, 0, 0, 0.55);
}
</style>
