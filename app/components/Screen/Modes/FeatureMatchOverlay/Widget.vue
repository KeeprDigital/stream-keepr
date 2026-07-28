<script setup lang="ts">
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayWidgetRender } from '~/modules/feature-match-overlay/renderModel';
import { graphicsVideoTargetForUserAgent } from '~~/shared/utils/graphicAssetTargetCompatibility';
import FeatureMatchOverlayGameWinsWidget from './GameWinsWidget.vue';
import FeatureMatchOverlayStatusWidget from './StatusWidget.vue';
import FeatureMatchOverlayTemplateLines from './TemplateLines.vue';

const props = defineProps<{
	render: FeatureMatchOverlayWidgetRender;
	output: FeatureMatchOverlayOutput;
}>();
const videoElement = useTemplateRef<HTMLVideoElement>('videoElement');
const videoTarget = computed(() => import.meta.client
	? graphicsVideoTargetForUserAgent(navigator.userAgent)
	: 'other');
const videoBlocked = computed(() => props.render.type === 'silent-video'
	&& props.render.videoCompatibility === 'chromium-transparency'
	&& videoTarget.value !== 'chromium');

watchEffect(() => {
	if (videoElement.value && props.render.type === 'silent-video')
		videoElement.value.playbackRate = props.render.playbackRate;
});

// Template-narrowing does not flow into the closure prop, so resolve here.
function gameWinBoxStyle(won: boolean) {
	if (props.render.type !== 'game-wins')
		return {};
	return won ? props.render.boxStyles.won : props.render.boxStyles.lost;
}
</script>

<template>
	<FeatureMatchOverlayTemplateLines
		v-if="render.type === 'text'"
		:lines="render.lines"
		:deck-colors="render.deckColors"
		:output="output"
	/>
	<img
		v-else-if="render.type === 'image'"
		:src="render.src"
		:alt="render.alt"
		:style="render.imageStyle"
	>
	<video
		v-else-if="render.type === 'silent-video' && !videoBlocked"
		ref="videoElement"
		:src="render.src"
		:style="render.mediaStyle"
		:loop="render.loop"
		autoplay
		muted
		playsinline
		preload="auto"
	/>
	<span
		v-else-if="render.type === 'silent-video'"
		data-video-compatibility-blocked="vp9-alpha-chromium-required"
	/>
	<span v-else-if="render.type === 'clock'">{{ render.displayTime }}</span>
	<FeatureMatchOverlayStatusWidget
		v-else-if="render.type === 'player-life'"
		:life-total="render.lifeTotal"
		:animation="render.animation"
		:duration-ms="render.durationMs"
		:accent-color="render.accentColor"
	/>
	<FeatureMatchOverlayGameWinsWidget
		v-else-if="render.type === 'game-wins'"
		:boxes="render.boxes"
		:wins="render.wins"
		:display-mode="render.displayMode"
		:box-style="gameWinBoxStyle"
		:style="render.containerStyle"
	/>
</template>
