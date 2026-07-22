<script setup lang="ts">
import type { CSSProperties } from 'vue';
import type { ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';

const props = defineProps<{
	media?: ScreenMediaBackgroundConfig;
}>();

const video = ref<HTMLVideoElement | null>(null);
const media = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(props.media ?? {}),
}));

const isVisible = computed(() => media.value.enabled && media.value.type === 'video' && media.value.url.trim().length > 0);
const playbackRate = computed(() => Math.max(0.1, Math.min(16, media.value.playbackRate || 1)));
const objectFit = computed(() => media.value.fit === 'fill' ? 'fill' : media.value.fit);
const videoStyle = computed<CSSProperties>(() => ({
	objectFit: objectFit.value,
	opacity: Math.max(0, Math.min(1, media.value.opacity)),
}));

function syncVideoPlayback() {
	const element = video.value;
	if (!element)
		return;

	element.defaultPlaybackRate = playbackRate.value;
	element.playbackRate = playbackRate.value;
	if (isVisible.value)
		void element.play().catch(() => {});
}

watch(media, () => {
	void nextTick(syncVideoPlayback);
}, { deep: true, immediate: true });

onMounted(syncVideoPlayback);
</script>

<template>
	<div
		v-if="isVisible"
		xmlns="http://www.w3.org/1999/xhtml"
		class="screen-media-background"
	>
		<video
			ref="video"
			:key="media.url"
			class="screen-media-background__video"
			:src="media.url"
			:style="videoStyle"
			:loop="media.loop"
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
