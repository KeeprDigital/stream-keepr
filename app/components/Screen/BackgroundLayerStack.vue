<script setup lang="ts">
import type { CSSProperties } from 'vue';
import type { AnimationEffectRenderPlan } from '~~/shared/animationEffects';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer, ScreenVideoPlayback } from '~~/shared/types/screenConfig';
import { animationEffectRenderPlan, parseAnimationEffectSelection } from '~~/shared/animationEffects';
import { screenMediaSourceReference } from '~~/shared/utils/graphicsAssetReferences';
import { screenMediaSourceUrl } from '~/utils/screenMediaSource';

/**
 * One rendered Background Layer stack, filling the nearest positioned ancestor.
 *
 * The Background Screen renders its `layers` through this, and every plain
 * overlay mode renders its own `backgroundLayers` through the same component
 * from the Screen renderer host, so a layer paints identically wherever it is
 * authored. The stack itself paints nothing behind the layers — the Background
 * Screen's black ground is that mode's own choice, not the stack's.
 */
const props = defineProps<{
	layers: BackgroundLayer[];
}>();

const enabledLayers = computed(() => props.layers.filter(layer => layer.enabled));

const assetReferences = computed<GraphicAssetReference[]>(() =>
	enabledLayers.value.flatMap((layer) => {
		if (layer.type !== 'image' && layer.type !== 'video')
			return [];
		const reference = screenMediaSourceReference(layer.source);
		return reference ? [reference] : [];
	}),
);

const { contentUrl } = useScreenGraphicAssetContentUrls(assetReferences);

/**
 * One rendered layer, everything already decided: media URLs resolved, the
 * animation selection re-proven, colour and gradient folded into the style.
 * The stack renders this flat view rather than branching on the union in the
 * template, so an unknown-effect animation layer simply contributes nothing.
 */
interface BackgroundLayerView {
	id: string;
	style: CSSProperties;
	imageUrl?: string;
	imageFit?: CSSProperties['objectFit'];
	video?: ScreenVideoPlayback;
	animation?: AnimationEffectRenderPlan;
}

function layerView(layer: BackgroundLayer): BackgroundLayerView {
	const view: BackgroundLayerView = {
		id: layer.id,
		style: { opacity: Math.max(0, Math.min(1, layer.opacity)) },
	};
	switch (layer.type) {
		case 'color':
			view.style.backgroundColor = layer.color;
			break;
		case 'gradient':
			view.style.backgroundImage = layer.gradient;
			break;
		case 'image':
			view.imageUrl = screenMediaSourceUrl(layer.source, contentUrl);
			view.imageFit = layer.fit;
			break;
		case 'video':
			// Opacity stays on the layer wrapper — the layer owns it, so the
			// shared media background renders at full opacity inside it.
			view.video = {
				url: screenMediaSourceUrl(layer.source, contentUrl),
				fit: layer.fit,
				opacity: 1,
				playbackRate: layer.playbackRate,
				loop: layer.loop,
			};
			break;
		case 'animation': {
			const selection = parseAnimationEffectSelection(layer.animation);
			if (selection)
				view.animation = animationEffectRenderPlan(selection);
			break;
		}
	}
	return view;
}

const layerViews = computed(() => enabledLayers.value.map(layerView));
</script>

<template>
	<div class="background-layer-stack" aria-hidden="true">
		<div
			v-for="view in layerViews"
			:key="view.id"
			class="background-layer-stack__layer"
			:data-layer-id="view.id"
			:style="view.style"
		>
			<img
				v-if="view.imageUrl"
				class="background-layer-stack__image"
				:src="view.imageUrl"
				:style="{ objectFit: view.imageFit }"
				alt=""
				aria-hidden="true"
			>
			<ScreenMediaBackground
				v-else-if="view.video"
				:video="view.video"
			/>
			<ScreenAnimationEffectSurface
				v-else-if="view.animation"
				:effect="view.animation.effect"
				:params="view.animation.params"
			/>
		</div>
	</div>
</template>

<style scoped>
.background-layer-stack {
	position: absolute;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
}

.background-layer-stack__layer {
	position: absolute;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
}

.background-layer-stack__image {
	display: block;
	width: 100%;
	height: 100%;
}
</style>
