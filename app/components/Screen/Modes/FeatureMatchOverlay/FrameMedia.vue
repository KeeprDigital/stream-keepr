<script setup lang="ts">
import type { FeatureMatchOverlayOutput, ScreenVideoPlayback } from '~~/shared/types/screenConfig';
import { featureMatchOverlayFrameContentMaskStyle } from '~/modules/feature-match-overlay/renderModel';
import ScreenMediaBackground from '../../MediaBackground.vue';

const props = defineProps<{
	/** The Frame's video with its source resolved; absent while it is switched off. */
	video?: ScreenVideoPlayback;
	canvasWidth: number;
	canvasHeight: number;
	cutoutPaths: readonly string[];
	output: FeatureMatchOverlayOutput;
}>();

const isVisible = computed(() => props.output !== 'key' && (props.video?.url.trim().length ?? 0) > 0);
const maskStyle = computed(() => featureMatchOverlayFrameContentMaskStyle(
	props.canvasWidth,
	props.canvasHeight,
	props.cutoutPaths,
));
</script>

<template>
	<foreignObject
		v-if="isVisible"
		x="0"
		y="0"
		:width="canvasWidth"
		:height="canvasHeight"
	>
		<div
			xmlns="http://www.w3.org/1999/xhtml"
			class="frame-media"
			:style="maskStyle"
		>
			<ScreenMediaBackground :video="video" />
		</div>
	</foreignObject>
</template>

<style scoped>
.frame-media {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	contain: paint;
}
</style>
