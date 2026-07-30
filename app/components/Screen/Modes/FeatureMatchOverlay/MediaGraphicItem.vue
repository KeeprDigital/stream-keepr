<script setup lang="ts">
import type { FeatureMatchOverlayMediaGraphicItemRenderModel } from '~/modules/feature-match-overlay/renderModel';
import { screenGraphicAssetReferenceTargetCompatibility } from '~~/shared/utils/graphicsAssetReferences';

const props = defineProps<{ media: FeatureMatchOverlayMediaGraphicItemRenderModel }>();
const videoElement = useTemplateRef<HTMLVideoElement>('videoElement');
const actualTarget = useGraphicsVideoTarget();
const blocked = computed(() => !props.media.item.asset
	? false
	: screenGraphicAssetReferenceTargetCompatibility({
		reference: props.media.item.asset,
		ownerSlot: 'media',
		kind: props.media.item.mediaKind,
		videoCompatibility: props.media.item.videoCompatibility,
		videoTarget: props.media.item.videoTarget,
	}, actualTarget.value).outcome === 'blocked');

watchEffect(() => {
	if (videoElement.value)
		videoElement.value.playbackRate = props.media.item.playbackRate ?? 1;
});
</script>

<template>
	<div :style="media.style">
		<video
			v-if="media.item.mediaKind === 'silent-video' && !blocked"
			ref="videoElement"
			:src="media.src"
			:loop="media.item.loop ?? true"
			autoplay
			muted
			playsinline
			preload="auto"
			:style="media.contentStyle"
		/>
		<span
			v-else-if="media.item.mediaKind === 'silent-video'"
			data-video-compatibility-blocked="vp9-alpha-chromium-required"
		/>
		<img
			v-else
			:src="media.src"
			:alt="media.item.label"
			:style="media.contentStyle"
		>
	</div>
</template>
