<script setup lang="ts">
import type { CSSProperties } from 'vue';
import type { AnimationEffectName, AnimationEffectParamsMap } from '~~/shared/animationEffects';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer, ScreenMediaBackgroundConfig, ScreenMediaSource } from '~~/shared/types/screenConfig';
import { parseAnimationEffectSelection } from '~~/shared/animationEffects';

const config = useScreenModeConfig('background');

const layers = computed<BackgroundLayer[]>(() => config.value.layers ?? []);
const enabledLayers = computed(() => layers.value.filter(layer => layer.enabled));

function assetReference(source: ScreenMediaSource): GraphicAssetReference | null {
	return source.kind === 'asset'
		? { assetId: source.assetId, revisionId: source.revisionId }
		: null;
}

const assetReferences = computed<GraphicAssetReference[]>(() =>
	enabledLayers.value.flatMap((layer) => {
		if (layer.type !== 'image' && layer.type !== 'video')
			return [];
		const reference = assetReference(layer.source);
		return reference ? [reference] : [];
	}),
);

const { contentUrl } = useScreenGraphicAssetContentUrls(assetReferences);

function sourceUrl(source: ScreenMediaSource): string {
	if (source.kind === 'url')
		return source.url;
	const reference = assetReference(source);
	return reference ? contentUrl(reference) : '';
}

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
	media?: ScreenMediaBackgroundConfig;
	animation?: {
		effect: AnimationEffectName;
		params?: AnimationEffectParamsMap[AnimationEffectName];
	};
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
			view.imageUrl = sourceUrl(layer.source);
			view.imageFit = layer.fit;
			break;
		case 'video':
			// Opacity stays on the layer wrapper — the layer owns it, so the
			// shared media background renders at full opacity inside it.
			view.media = {
				enabled: true,
				type: 'video',
				url: sourceUrl(layer.source),
				fit: layer.fit,
				opacity: 1,
				playbackRate: layer.playbackRate,
				loop: layer.loop,
			};
			break;
		case 'animation': {
			const selection = parseAnimationEffectSelection(layer.animation);
			if (selection) {
				view.animation = {
					effect: selection.effect,
					params: selection.params as AnimationEffectParamsMap[AnimationEffectName] | undefined,
				};
			}
			break;
		}
	}
	return view;
}

const layerViews = computed(() => enabledLayers.value.map(layerView));
</script>

<template>
	<div class="background-screen">
		<div
			v-for="view in layerViews"
			:key="view.id"
			class="background-screen__layer"
			:data-layer-id="view.id"
			:style="view.style"
		>
			<img
				v-if="view.imageUrl"
				class="background-screen__image"
				:src="view.imageUrl"
				:style="{ objectFit: view.imageFit }"
				alt=""
				aria-hidden="true"
			>
			<ScreenMediaBackground
				v-else-if="view.media"
				:media="view.media"
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
.background-screen {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	/* Empty — and anything the stack leaves uncovered — is black, not host chrome. */
	background: #000;
}

.background-screen__layer {
	position: absolute;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
}

.background-screen__image {
	display: block;
	width: 100%;
	height: 100%;
}
</style>
