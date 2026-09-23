<script setup lang="ts">
import type { AnimationEffectName, AnimationEffectParamsMap } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from '~/utils/animation-effects';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { loadAnimationEffect } from '~/utils/animation-effects';

/**
 * The host-agnostic Animation Effect mount: one div an effect renderer draws
 * into, with the loading, clock, resize, and disposal every host shares.
 *
 * Per ADR-0014, the renderer must not assume the Feature Match Overlay — this
 * component is where that rule lives. A host decides *whether* an effect shows
 * (the Frame's enabled flag and key-output rule, a Background Layer's enabled
 * state) and at what opacity; this component only ever renders the named
 * effect. Given `width`/`height` it sizes to them (the Frame's pixel-exact
 * canvas); without them it follows its own element's size (a Background Layer
 * filling whatever viewport the Screen Output has).
 */
const props = defineProps<{
	effect: AnimationEffectName;
	/** Fully-defaulted params; absent means the effect's schema defaults. */
	params?: AnimationEffectParamsMap[AnimationEffectName];
	width?: number;
	height?: number;
}>();

type AnyAnimationEffectParams = AnimationEffectParamsMap[AnimationEffectName];

const host = ref<HTMLElement | null>(null);
const instance = shallowRef<AnimationEffectInstance<AnyAnimationEffectParams> | null>(null);
let currentEffect: AnimationEffectName | null = null;
let mountGeneration = 0;
let frameHandle: number | null = null;
let appliedSize: { width: number; height: number } | null = null;
let resizeObserver: ResizeObserver | null = null;

function resolvedParams(): AnyAnimationEffectParams {
	return props.params ?? animationEffectDefaultParams(props.effect);
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

function targetSize(): { width: number; height: number } {
	if (props.width != null && props.height != null)
		return { width: props.width, height: props.height };
	return {
		width: host.value?.clientWidth ?? 0,
		height: host.value?.clientHeight ?? 0,
	};
}

function resizeToTarget() {
	// With no instance there is nothing to size, and recording `appliedSize`
	// would be worse than useless: the ResizeObserver's initial callback fires
	// while the effect module is still loading, and a size recorded then makes
	// the post-mount resize an early return — the renderer stays at its default
	// size and a shader-plane effect renders as a flat, static layer.
	if (!instance.value)
		return;
	const size = targetSize();
	if (appliedSize && appliedSize.width === size.width && appliedSize.height === size.height)
		return;
	instance.value.resize(size.width, size.height);
	appliedSize = size;
}

async function mountAnimation() {
	const generation = ++mountGeneration;
	if (!host.value) {
		disposeAnimation();
		return;
	}

	if (instance.value && currentEffect === props.effect) {
		instance.value.setParams(resolvedParams());
		resizeToTarget();
		return;
	}

	disposeAnimation();
	const factory = await loadAnimationEffect(props.effect);
	if (generation !== mountGeneration || !host.value)
		return;
	instance.value = factory(host.value, resolvedParams());
	currentEffect = props.effect;
	resizeToTarget();
	startLoop();
}

watch([() => props.effect, () => props.params, () => props.width, () => props.height], () => {
	void mountAnimation();
}, { deep: true });

onMounted(() => {
	// A host with no fixed size is followed through its own element, so a
	// viewport resize reaches the renderer without the host having to relay it.
	if (props.width == null && typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(() => resizeToTarget());
		if (host.value)
			resizeObserver.observe(host.value);
	}
	void mountAnimation();
});

onBeforeUnmount(() => {
	mountGeneration++;
	resizeObserver?.disconnect();
	resizeObserver = null;
	disposeAnimation();
});
</script>

<template>
	<div
		ref="host"
		class="animation-effect-surface"
	/>
</template>

<style scoped>
.animation-effect-surface {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	transform: translateZ(0);
	contain: paint;
}
</style>
