<script setup lang="ts">
import type { FeatureMatchOverlayFrameAnimationConfig, FeatureMatchOverlayFrameAnimationEffect, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { AnimationInstance } from '~/utils/animation-effects';
import { loadAnimationEffect } from '~/utils/animation-effects';

type ThreeModule = typeof import('three');

const props = defineProps<{
	animation?: FeatureMatchOverlayFrameAnimationConfig;
	canvasWidth: number;
	canvasHeight: number;
	maskId: string;
	output: FeatureMatchOverlayOutput;
}>();

const host = ref<HTMLElement | null>(null);
const instance = shallowRef<AnimationInstance | null>(null);
const animationFrame = ref<number | null>(null);
const currentEffect = ref<FeatureMatchOverlayFrameAnimationEffect | null>(null);
let mountGeneration = 0;
const randomMovement = ref({
	fromX: 0.5,
	fromY: 0.5,
	toX: 0.5,
	toY: 0.5,
	segmentStartedAt: 0,
});

const isVisible = computed(() => props.output !== 'key' && props.animation?.enabled === true);
const hostStyle = computed(() => ({
	opacity: Math.max(0, Math.min(1, props.animation?.opacity ?? 0.45)),
}));

function colorToHexNumber(color: string | undefined, fallback: string) {
	const normalized = (color || fallback).trim().replace(/^#/, '');
	return Number.parseInt(normalized.length === 3
		? normalized.split('').map(char => `${char}${char}`).join('')
		: normalized,	16);
}

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value ?? fallback));
}

function effectOptions(animation: FeatureMatchOverlayFrameAnimationConfig, three: ThreeModule) {
	const color = colorToHexNumber(animation.color, '#7c3aed');
	const color1 = colorToHexNumber(animation.color1, '#008c8c');
	const color2 = colorToHexNumber(animation.color2, '#06b6d4');
	const backgroundColor = colorToHexNumber(animation.backgroundColor, '#111111');
	const baseColor = colorToHexNumber(animation.baseColor, '#111111');

	const common = {
		THREE: three,
		mouseControls: false,
		touchControls: false,
		gyroControls: false,
		minHeight: props.canvasHeight,
		minWidth: props.canvasWidth,
		scale: 1,
		scaleMobile: 1,
		backgroundAlpha: 1,
		forceAnimate: true,
	};

	switch (animation.effect) {
		case 'cells':
			return {
				...common,
				color1,
				color2,
				backgroundColor,
				amplitudeFactor: clamp(animation.amplitudeFactor, 1, 0, 4),
				ringFactor: clamp(animation.ringFactor, 1, 0, 8),
				rotationFactor: clamp(animation.rotationFactor, 1, 0, 4),
				size: clamp(animation.size, 1.5, 0.2, 5),
				speed: clamp(animation.speed, 1, 0, 4),
			};
		case 'dots':
			return {
				...common,
				color,
				color2,
				backgroundColor,
				size: clamp(animation.size, 3, 0.5, 20),
				spacing: clamp(animation.spacing, 34, 5, 100),
				showLines: animation.showLines ?? true,
			};
		case 'globe':
			return {
				...common,
				color,
				color2,
				backgroundColor,
				size: clamp(animation.size, 1, 0.2, 5),
				points: clamp(animation.points, 10, 2, 30),
				maxDistance: clamp(animation.maxDistance, 22, 1, 80),
				spacing: clamp(animation.spacing, 16, 2, 80),
				showDots: animation.showDots ?? true,
			};
		case 'halo':
			return {
				...common,
				baseColor,
				color2,
				backgroundColor,
				amplitudeFactor: clamp(animation.amplitudeFactor, 1, 0, 4),
				ringFactor: clamp(animation.ringFactor, 1, 0, 8),
				rotationFactor: clamp(animation.rotationFactor, 1, 0, 4),
				xOffset: clamp(animation.xOffset, 0, -1, 1),
				yOffset: clamp(animation.yOffset, 0, -1, 1),
				size: clamp(animation.size, 1, 0.2, 5),
				speed: clamp(animation.speed, 1, 0, 4),
				mouseEase: true,
			};
		case 'net':
			return {
				...common,
				color,
				backgroundColor,
				points: clamp(animation.points, 10, 2, 30),
				maxDistance: clamp(animation.maxDistance, 22, 1, 80),
				spacing: clamp(animation.spacing, 16, 2, 80),
				showDots: animation.showDots ?? true,
			};
		case 'rings':
			return {
				...common,
				color,
				backgroundColor,
			};
		case 'ripple':
			return {
				...common,
				color1,
				color2,
				backgroundColor,
				amplitudeFactor: clamp(animation.amplitudeFactor, 1, 0, 4),
				ringFactor: clamp(animation.ringFactor, 4, 0, 12),
				rotationFactor: clamp(animation.rotationFactor, 0.1, 0, 4),
				speed: clamp(animation.speed, 1, 0, 4),
			};
		case 'waves':
			return {
				...common,
				color,
				backgroundColor,
				shininess: clamp(animation.shininess, 30, 0, 100),
				waveHeight: clamp(animation.waveHeight, 20, 0, 50),
				waveSpeed: clamp(animation.waveSpeed, 1, 0, 4),
				zoom: clamp(animation.zoom, 0.85, 0.5, 3),
			};
		case 'fog':
		default:
			return {
				...common,
				highlightColor: colorToHexNumber(animation.highlightColor, '#f59e0b'),
				midtoneColor: colorToHexNumber(animation.midtoneColor, '#7c3aed'),
				lowlightColor: colorToHexNumber(animation.lowlightColor, '#06b6d4'),
				baseColor,
				blurFactor: clamp(animation.blurFactor, 0.55, 0.1, 0.95),
				speed: clamp(animation.speed, 0.6, 0, 4),
				zoom: clamp(animation.zoom, 1, 0.5, 3),
			};
	}
}

function stopMovement() {
	if (animationFrame.value != null) {
		cancelAnimationFrame(animationFrame.value);
		animationFrame.value = null;
	}
}

function randomMovementPoint(radius: number) {
	const angle = Math.random() * Math.PI * 2;
	const distance = Math.sqrt(Math.random()) * radius;
	return {
		x: 0.5 + Math.cos(angle) * distance,
		y: 0.5 + Math.sin(angle) * distance,
	};
}

function startMovement() {
	stopMovement();
	if (!props.animation?.mouseDriftEnabled)
		return;

	const startedAt = performance.now();
	randomMovement.value = { fromX: 0.5, fromY: 0.5, toX: 0.5, toY: 0.5, segmentStartedAt: startedAt };
	const tick = (now: number) => {
		const animation = props.animation;
		const animationInstance = instance.value;
		if (!animation || !animationInstance?.setInteractionPoint)
			return;

		const cycleMs = Math.max(2, animation.mouseDriftSeconds) * 1000;
		const radius = Math.max(0, Math.min(0.5, animation.mouseDriftRadius));
		let normalizedX = 0.5;
		let normalizedY = 0.5;

		if (animation.mouseDriftMode === 'random') {
			const segmentMs = cycleMs / 2;
			const state = randomMovement.value;
			if (now - state.segmentStartedAt >= segmentMs) {
				const next = randomMovementPoint(radius);
				randomMovement.value = {
					fromX: state.toX,
					fromY: state.toY,
					toX: next.x,
					toY: next.y,
					segmentStartedAt: now,
				};
			}
			const updatedState = randomMovement.value;
			const progress = Math.max(0, Math.min(1, (now - updatedState.segmentStartedAt) / segmentMs));
			const eased = progress * progress * (3 - 2 * progress);
			normalizedX = updatedState.fromX + (updatedState.toX - updatedState.fromX) * eased;
			normalizedY = updatedState.fromY + (updatedState.toY - updatedState.fromY) * eased;
		}
		else {
			const phase = ((now - startedAt) / cycleMs) * Math.PI * 2;
			normalizedX = 0.5 + Math.cos(phase) * radius;
			normalizedY = 0.5 + Math.sin(phase * 0.73) * radius;
		}

		animationInstance.setInteractionPoint(normalizedX, normalizedY);
		animationFrame.value = requestAnimationFrame(tick);
	};
	animationFrame.value = requestAnimationFrame(tick);
}

function enhanceWavesInstance(animationInstance: AnimationInstance, three: ThreeModule) {
	if (!animationInstance.scene)
		return;

	for (const child of animationInstance.scene.children) {
		if (child instanceof three.AmbientLight)
			child.intensity = 0.25;
		if (child instanceof three.PointLight)
			child.intensity = 2.4;
	}

	if (!animationInstance.scene.userData.streamKeeprWaveLight) {
		const directional = new three.DirectionalLight(0xFFFFFF, 2.2);
		directional.position.set(260, 420, 180);
		animationInstance.scene.add(directional);
		animationInstance.scene.userData.streamKeeprWaveLight = true;
	}

	if (animationInstance.plane?.material instanceof three.MeshPhongMaterial) {
		animationInstance.plane.material.flatShading = true;
		animationInstance.plane.material.needsUpdate = true;
	}
}

function disposeAnimation() {
	stopMovement();
	instance.value?.destroy();
	instance.value = null;
	currentEffect.value = null;
}

function destroyAnimation() {
	mountGeneration++;
	disposeAnimation();
}

async function mountAnimation() {
	const animation = props.animation;
	const generation = ++mountGeneration;
	if (!host.value || !isVisible.value || !animation) {
		disposeAnimation();
		return;
	}

	if (instance.value && currentEffect.value === animation.effect) {
		const three = await import('three');
		if (generation !== mountGeneration || !instance.value)
			return;
		instance.value.setOptions?.(effectOptions(animation, three));
		instance.value.resize?.();
		if (animation.effect === 'waves')
			enhanceWavesInstance(instance.value, three);
		startMovement();
		return;
	}

	disposeAnimation();
	const [factory, three] = await Promise.all([
		loadAnimationEffect(animation.effect),
		import('three'),
	]);
	if (generation !== mountGeneration || !host.value || !isVisible.value || props.animation?.effect !== animation.effect)
		return;
	instance.value = factory({ el: host.value, ...effectOptions(animation, three) });
	currentEffect.value = animation.effect;
	if (animation.effect === 'waves')
		enhanceWavesInstance(instance.value, three);
	startMovement();
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

.frame-animation :deep(.animation-canvas) {
	width: 100% !important;
	height: 100% !important;
}
</style>
