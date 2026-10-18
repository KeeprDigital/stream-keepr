<script setup lang="ts">
import type { CSSProperties } from 'vue';
import type { ScreenVideoPlayback } from '~~/shared/types/screenConfig';

/**
 * One Screen-owned looping video, its source already resolved: a video
 * Background Layer and the Feature Match Overlay Frame's video both play
 * through this.
 */
const props = defineProps<{
	video?: ScreenVideoPlayback;
}>();

const element = ref<HTMLVideoElement | null>(null);

const isVisible = computed(() => (props.video?.url.trim().length ?? 0) > 0);
const playbackRate = computed(() => Math.max(0.1, Math.min(16, props.video?.playbackRate || 1)));
const videoStyle = computed<CSSProperties>(() => ({
	objectFit: props.video?.fit ?? 'cover',
	opacity: Math.max(0, Math.min(1, props.video?.opacity ?? 1)),
}));

function syncVideoPlayback() {
	const current = element.value;
	if (!current)
		return;

	current.defaultPlaybackRate = playbackRate.value;
	current.playbackRate = playbackRate.value;
	if (isVisible.value)
		void current.play().catch(() => {});
}

watch(() => props.video, () => {
	void nextTick(syncVideoPlayback);
}, { deep: true, immediate: true });

onMounted(syncVideoPlayback);
</script>

<template>
	<div
		v-if="isVisible && video"
		xmlns="http://www.w3.org/1999/xhtml"
		class="screen-media-background"
	>
		<video
			ref="element"
			:key="video.url"
			class="screen-media-background__video"
			:src="video.url"
			:style="videoStyle"
			:loop="video.loop"
			muted
			playsinline
			autoplay
			preload="auto"
			aria-hidden="true"
			@loadedmetadata="syncVideoPlayback"
			@canplay="syncVideoPlayback"
		/>
	</div>
</template>

<style scoped>
.screen-media-background {
	position: absolute;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
	background: transparent;
}

.screen-media-background__video {
	display: block;
	width: 100%;
	height: 100%;
}
</style>
