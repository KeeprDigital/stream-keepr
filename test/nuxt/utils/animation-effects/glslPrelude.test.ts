import type { AnimationEffectName } from '~~/shared/animationEffects';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { loadAnimationEffect } from '~/utils/animation-effects';
import * as prelude from '~/utils/animation-effects/glslPrelude';
import { createHostStub } from './threeStub';

/**
 * The shader-plane base is replaced by a recorder, so mounting an effect hands
 * back the fragment shader it would compile and nothing else runs.
 */
const createShaderPlaneEffect = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('~/utils/animation-effects/shaderPlane', () => ({ createShaderPlaneEffect }));

async function emittedFragmentShader(effect: AnimationEffectName): Promise<string> {
	const factory = await loadAnimationEffect(effect);
	factory(createHostStub(), animationEffectDefaultParams(effect) as never);
	const [options] = createShaderPlaneEffect.mock.calls.at(-1) as unknown as [{ fragmentShader: string }];
	return options.fragmentShader;
}

/** The sin-dot hash's multiplier: any helper that hashes carries it. */
const HASH_MULTIPLIER = '43758.5453';

beforeEach(() => {
	createShaderPlaneEffect.mockClear();
});

describe('the shared GLSL prelude', () => {
	// The effects written for Stream Keepr. The fork ports (fog, cells) keep
	// their fork-faithful helpers inline, so they are not held to this.
	it.each([
		['ember', [prelude.GLSL_HASH_2D_SALTED]],
		['shards', [prelude.GLSL_HASH_2D_SALTED]],
		['inkmap', [prelude.GLSL_HASH_2D, prelude.GLSL_VALUE_NOISE_2D]],
		['ridgelines', [prelude.GLSL_HASH_1D, prelude.GLSL_VALUE_NOISE_1D]],
		['weave', [prelude.GLSL_HASH_1D]],
	] as const)('is where %s takes its hash and noise helpers from', async (effect, snippets) => {
		let shader = await emittedFragmentShader(effect);
		for (const snippet of snippets) {
			expect(shader).toContain(snippet);
			shader = shader.replace(snippet, '');
		}
		expect(shader).not.toContain(HASH_MULTIPLIER);
	});
});
