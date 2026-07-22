import type { FeatureMatchOverlayFrameAnimationEffect } from '~~/shared/types/screenConfig';
import type { AnimationFactory } from './types';

const effectLoaders = {
	cells: () => import('./cells'),
	dots: () => import('./dots'),
	fog: () => import('./fog'),
	globe: () => import('./globe'),
	halo: () => import('./halo'),
	net: () => import('./net'),
	rings: () => import('./rings'),
	ripple: () => import('./ripple'),
	waves: () => import('./waves'),
} satisfies Record<FeatureMatchOverlayFrameAnimationEffect, () => Promise<{ default: unknown }>>;

export async function loadAnimationEffect(effect: FeatureMatchOverlayFrameAnimationEffect): Promise<AnimationFactory> {
	const loader = effectLoaders[effect] ?? effectLoaders.fog;
	const module = await loader();
	return module.default as AnimationFactory;
}

export type { AnimationFactory, AnimationInstance, AnimationOptions } from './types';
