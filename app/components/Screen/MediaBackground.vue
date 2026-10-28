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

const elements = new Map<string, HTMLVideoElement>();

const isVisible = computed(() => (props.video?.url.trim().length ?? 0) > 0);
const playbackRate = computed(() => Math.max(0.1, Math.min(16, props.video?.playbackRate || 1)));
const videoStyle = computed<CSSProperties>(() => ({
	objectFit: props.video?.fit ?? 'cover',
	opacity: Math.max(0, Math.min(1, props.video?.opacity ?? 1)),
}));

/**
 * A new source loads behind the one playing, which keeps playing until the new
 * one has its first frame (or fails), so a source change never shows a blank
 * frame (ADR-0053). A change back to the playing source drops the one loading.
 */
const playingUrl = ref<string | null>(null);
const loadingUrl = ref<string | null>(null);

watch(() => isVisible.value ? props.video!.url : null, (url) => {
	if (!url || playingUrl.value === null) {
		playingUrl.value = url;
		loadingUrl.value = null;
		return;
	}
	loadingUrl.value = url === playingUrl.value
		? null
		: url;
}, { immediate: true });

function promote(url: string) {
	if (url !== loadingUrl.value)
		return;
	playingUrl.value = url;
	loadingUrl.value = null;
}

const sources = computed(() => [playingUrl.value, loadingUrl.value].filter((url): url is string => url !== null));

function setElement(url: string, el: unknown) {
	if (el instanceof HTMLVideoElement)
		elements.set(url, el);
	else
		elements.delete(url);
}

function syncVideoPlayback() {
	for (const current of elements.values()) {
		current.defaultPlaybackRate = playbackRate.value;
		current.playbackRate = playbackRate.value;
		if (isVisible.value)
			void current.play().catch(() => {});
	}
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
			v-for="url in sources"
			:key="url"
			:ref="el => setElement(url, el)"
			class="screen-media-background__video"
			:src="url"
			:style="[videoStyle, url === loadingUrl ? { opacity: 0 } : undefined]"
			:data-video-loading="url === loadingUrl ? 'true' : undefined"
			:loop="video.loop"
			muted
			playsinline
			autoplay
			preload="auto"
			aria-hidden="true"
			@loadedmetadata="syncVideoPlayback"
			@canplay="syncVideoPlayback"
			@loadeddata="promote(url)"
			@error="promote(url)"
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

/* The source loading sits over the one playing, transparent until it takes over. */
.screen-media-background__video {
	position: absolute;
	inset: 0;
	display: block;
	width: 100%;
	height: 100%;
}
</style>
