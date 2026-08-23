import type { AnimationEffectName, AnimationEffectParamsMap } from '~~/shared/animationEffects';
import type { AnimationEffectFactory } from './types';

/**
 * The renderers behind the Animation Effect catalogue, one lazy chunk per
 * effect so a Screen Output only downloads the effect (and three.js) it shows.
 * The keys are pinned to the catalogue's closed vocabulary: an effect name that
 * validates always resolves a renderer here, and one that does not validate
 * never reaches this map — refused upstream rather than approximated.
 */
const effectLoaders: {
	[Effect in AnimationEffectName]: () => Promise<{ default: AnimationEffectFactory<AnimationEffectParamsMap[Effect]> }>;
} = {
	caustics: () => import('./caustics'),
	fog: () => import('./fog'),
};

export async function loadAnimationEffect<Effect extends AnimationEffectName>(
	effect: Effect,
): Promise<AnimationEffectFactory<AnimationEffectParamsMap[Effect]>> {
	const module = await effectLoaders[effect]();
	return module.default;
}

export type { AnimationEffectFactory, AnimationEffectInstance } from './types';
