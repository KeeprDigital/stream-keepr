<script setup lang="ts">
import type { AnimationEffectRenderPlan, FeatureMatchOverlayFrameAnimationConfig } from '~~/shared/animationEffects';
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { animationEffectRenderPlan, parseFrameAnimationConfig } from '~~/shared/animationEffects';
import ScreenAnimationEffectSurface from '~/components/Screen/AnimationEffectSurface.vue';

const props = defineProps<{
	animation?: FeatureMatchOverlayFrameAnimationConfig;
	canvasWidth: number;
	canvasHeight: number;
	maskId: string;
	output: FeatureMatchOverlayOutput;
}>();

/** A pre-rebuild or unknown-effect config parses to nothing and renders nothing. */
const parsedAnimation = computed(() => parseFrameAnimationConfig(props.animation));

const isVisible = computed(() => props.output !== 'key' && parsedAnimation.value?.enabled === true);
const hostStyle = computed(() => ({ opacity: parsedAnimation.value?.opacity ?? 0 }));

const renderPlan = computed<AnimationEffectRenderPlan | null>(() => {
	const config = parsedAnimation.value;
	return config ? animationEffectRenderPlan(config) : null;
});
</script>

<template>
	<foreignObject
		v-if="isVisible && renderPlan"
		x="0"
		y="0"
		:width="canvasWidth"
		:height="canvasHeight"
		:mask="`url(#${maskId})`"
	>
		<div
			xmlns="http://www.w3.org/1999/xhtml"
			class="frame-animation"
			:style="hostStyle"
		>
			<ScreenAnimationEffectSurface
				:effect="renderPlan.effect"
				:params="renderPlan.params"
				:width="canvasWidth"
				:height="canvasHeight"
			/>
		</div>
	</foreignObject>
</template>

<style scoped>
.frame-animation {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
}
</style>
