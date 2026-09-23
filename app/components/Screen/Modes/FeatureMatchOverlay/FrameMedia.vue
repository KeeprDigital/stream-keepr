<script setup lang="ts">
import type { FeatureMatchOverlayOutput, ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import { featureMatchOverlayFrameContentMaskStyle } from '~/modules/feature-match-overlay/renderModel';
import ScreenMediaBackground from '../../MediaBackground.vue';

const props = defineProps<{
	media?: ScreenMediaBackgroundConfig;
	canvasWidth: number;
	canvasHeight: number;
	cutoutPaths: readonly string[];
	output: FeatureMatchOverlayOutput;
}>();

const isVisible = computed(() => props.output !== 'key' && props.media?.enabled === true && props.media.url.trim().length > 0);
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
			<ScreenMediaBackground :media="media" />
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
