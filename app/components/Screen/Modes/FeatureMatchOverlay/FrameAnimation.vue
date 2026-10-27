<script setup lang="ts">
import type { AnimationEffectRenderPlan, AnimationEffectSelection, FeatureMatchOverlayFrameAnimationConfig } from '~~/shared/animationEffects';
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { animationEffectRenderPlan, parseAnimationEffectSelection, parseFrameAnimationConfig } from '~~/shared/animationEffects';
import ScreenAnimationEffectSurface from '~/components/Screen/AnimationEffectSurface.vue';
import { featureMatchOverlayFrameContentMaskStyle } from '~/modules/feature-match-overlay/renderModel';

const props = defineProps<{
	/** Whether the Frame shows its effect, and at what opacity. */
	animation?: FeatureMatchOverlayFrameAnimationConfig;
	/** Which effect: the `frame-animation-effect` Mode Token (#831). */
	effect?: AnimationEffectSelection;
	canvasWidth: number;
	canvasHeight: number;
	cutoutPaths: readonly string[];
	output: FeatureMatchOverlayOutput;
}>();

/** A pre-rebuild or unknown-effect config parses to nothing and renders nothing. */
const parsedAnimation = computed(() => parseFrameAnimationConfig(props.animation));

const isVisible = computed(() => props.output !== 'key' && parsedAnimation.value?.enabled === true);
const hostStyle = computed(() => ({
	...featureMatchOverlayFrameContentMaskStyle(
		props.canvasWidth,
		props.canvasHeight,
		props.cutoutPaths,
	),
	opacity: parsedAnimation.value?.opacity ?? 0,
}));

/** An effect this build does not ship parses to nothing and renders nothing. */
const renderPlan = computed<AnimationEffectRenderPlan | null>(() => {
	const selection = parseAnimationEffectSelection(props.effect);
	return selection
		? animationEffectRenderPlan(selection)
		: null;
});
</script>

<template>
	<foreignObject
		v-if="isVisible && renderPlan"
		x="0"
		y="0"
		:width="canvasWidth"
		:height="canvasHeight"
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
