<script setup lang="ts">
import type { AnimationEffectName, AnimationEffectParamsMap, FeatureMatchOverlayFrameAnimationConfig } from '~~/shared/animationEffects';
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { AnimationEffectInstance } from '~/utils/animation-effects';
import { animationEffectDefaultParams, parseFrameAnimationConfig } from '~~/shared/animationEffects';
import { loadAnimationEffect } from '~/utils/animation-effects';

const props = defineProps<{
	animation?: FeatureMatchOverlayFrameAnimationConfig;
	canvasWidth: number;
	canvasHeight: number;
	maskId: string;
	output: FeatureMatchOverlayOutput;
}>();

type AnyAnimationEffectParams = AnimationEffectParamsMap[AnimationEffectName];

interface RenderPlan {
	effect: AnimationEffectName;
	params: AnyAnimationEffectParams;
	opacity: number;
}

const host = ref<HTMLElement | null>(null);
const instance = shallowRef<AnimationEffectInstance<AnyAnimationEffectParams> | null>(null);
let currentEffect: AnimationEffectName | null = null;
let mountGeneration = 0;
let frameHandle: number | null = null;
let appliedSize: { width: number; height: number } | null = null;

/** A pre-rebuild or unknown-effect config parses to nothing and renders nothing. */
const parsedAnimation = computed(() => parseFrameAnimationConfig(props.animation));

const isVisible = computed(() => props.output !== 'key' && parsedAnimation.value?.enabled === true);
const hostStyle = computed(() => ({ opacity: parsedAnimation.value?.opacity ?? 0 }));

function renderPlan(): RenderPlan | null {
	const config = parsedAnimation.value;
	if (!config)
		return null;
	// The schema pairs each effect with its own params; the cast restates that
	// pairing where the union loses it.
	return {
		effect: config.effect,
		params: (config.params ?? animationEffectDefaultParams(config.effect)) as AnyAnimationEffectParams,
		opacity: config.opacity,
	};
}

function stopLoop() {
	if (frameHandle != null) {
		cancelAnimationFrame(frameHandle);
		frameHandle = null;
	}
}

function startLoop() {
	stopLoop();
	const startedAt = performance.now();
	const tick = (now: number) => {
		instance.value?.render((now - startedAt) / 1000);
		frameHandle = requestAnimationFrame(tick);
	};
	frameHandle = requestAnimationFrame(tick);
}

function disposeAnimation() {
	stopLoop();
	instance.value?.dispose();
	instance.value = null;
	currentEffect = null;
	appliedSize = null;
}

function destroyAnimation() {
	mountGeneration++;
	disposeAnimation();
}

function resizeToCanvas() {
	const size = { width: props.canvasWidth, height: props.canvasHeight };
	if (appliedSize && appliedSize.width === size.width && appliedSize.height === size.height)
		return;
	instance.value?.resize(size.width, size.height);
	appliedSize = size;
}

async function mountAnimation() {
	const plan = renderPlan();
	const generation = ++mountGeneration;
	if (!host.value || !isVisible.value || !plan) {
		disposeAnimation();
		return;
	}

	if (instance.value && currentEffect === plan.effect) {
		instance.value.setParams(plan.params);
		resizeToCanvas();
		return;
	}

	disposeAnimation();
	const factory = await loadAnimationEffect(plan.effect);
	if (generation !== mountGeneration || !host.value || !isVisible.value)
		return;
	instance.value = factory(host.value, plan.params);
	currentEffect = plan.effect;
	resizeToCanvas();
	startLoop();
}

watch([() => props.animation, isVisible, () => props.canvasWidth, () => props.canvasHeight], () => {
	void mountAnimation();
}, { deep: true });

onMounted(() => {
	void mountAnimation();
});

onBeforeUnmount(() => {
	destroyAnimation();
});
</script>

<template>
	<foreignObject
		v-if="isVisible"
		x="0"
		y="0"
		:width="canvasWidth"
		:height="canvasHeight"
		:mask="`url(#${maskId})`"
	>
		<div
			ref="host"
			xmlns="http://www.w3.org/1999/xhtml"
			class="frame-animation"
			:style="hostStyle"
		/>
	</foreignObject>
</template>

<style scoped>
.frame-animation {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	transform: translateZ(0);
	contain: paint;
}
</style>
