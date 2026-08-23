import { describe, expect, it } from 'vitest';
import {
	ANIMATION_EFFECT_CATALOGUE,
	ANIMATION_EFFECT_VALUES,
	animationEffectDefaultParams,
	animationEffectParamFields,
	featureMatchOverlayFrameAnimationConfigSchema,
	storedFrameAnimationConfigSchema,
} from '~~/shared/animationEffects';

const PRE_REBUILD_FLAT_BAG = {
	enabled: true,
	effect: 'fog',
	opacity: 0.45,
	highlightColor: '#f59e0b',
	blurFactor: 0.55,
	mouseDriftEnabled: true,
	mouseDriftMode: 'orbit',
	mouseDriftSeconds: 18,
	mouseDriftRadius: 0.28,
};

describe('animationEffects catalogue', () => {
	it('names every effect in the closed vocabulary exactly once', () => {
		expect(ANIMATION_EFFECT_VALUES).toEqual(['caustics', 'cells', 'fog', 'ripple']);
		expect(Object.keys(ANIMATION_EFFECT_CATALOGUE).sort()).toEqual([...ANIMATION_EFFECT_VALUES].sort());
	});

	it('ports cells and ripple under the defaults the pre-rebuild application shipped', () => {
		// The ports keep their old names and their old on-air look: defaults come
		// from the retired editor's shared bag, not the fork's own defaultOptions.
		expect(animationEffectDefaultParams('cells')).toEqual({
			color1: '#008c8c',
			color2: '#06b6d4',
			size: 3,
			speed: 0.6,
		});
		expect(animationEffectDefaultParams('ripple')).toEqual({
			color1: '#008c8c',
			color2: '#06b6d4',
			backgroundColor: '#111111',
			amplitudeFactor: 1,
			ringFactor: 1,
			rotationFactor: 1,
			speed: 0.6,
		});
	});

	it('fills every parameter from the schema alone, so an empty config renders', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const defaults = animationEffectDefaultParams(effect);
			const reparsed = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.parse({});
			expect(reparsed).toEqual(defaults);
			expect(Object.keys(defaults).length).toBeGreaterThan(0);
		}
	});

	it('describes every parameter as an editor field with its default inside its range', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const defaults = animationEffectDefaultParams(effect) as Record<string, unknown>;
			const fields = animationEffectParamFields(effect);
			expect(fields.map(field => field.key).sort()).toEqual(Object.keys(defaults).sort());
			for (const field of fields) {
				expect(field.label.length).toBeGreaterThan(0);
				expect(field.defaultValue).toEqual(defaults[field.key]);
				if (field.control === 'number') {
					expect(field.min).toBeTypeOf('number');
					expect(field.max).toBeTypeOf('number');
					expect(field.step).toBeTypeOf('number');
					expect(field.defaultValue).toBeGreaterThanOrEqual(field.min!);
					expect(field.defaultValue).toBeLessThanOrEqual(field.max!);
				}
			}
		}
	});

	it('refuses an out-of-range parameter rather than clamping it', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const [numberField] = animationEffectParamFields(effect).filter(field => field.control === 'number');
			expect(numberField).toBeDefined();
			const outcome = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.safeParse({
				[numberField!.key]: numberField!.max! + 1,
			});
			expect(outcome.success).toBe(false);
		}
	});

	it('refuses a colour that is not a hex colour', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const [colorField] = animationEffectParamFields(effect).filter(field => field.control === 'color');
			expect(colorField).toBeDefined();
			const outcome = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.safeParse({
				[colorField!.key]: 'url(javascript:alert(1))',
			});
			expect(outcome.success).toBe(false);
		}
	});

	it('refuses a parameter no effect schema declares', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const outcome = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.safeParse({ mouseDriftEnabled: true });
			expect(outcome.success).toBe(false);
		}
	});
});

describe('featureMatchOverlayFrameAnimationConfigSchema', () => {
	it('accepts a sparse config for every effect and leaves the params sparse', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse({
				enabled: true,
				effect,
				opacity: 0.5,
			});
			expect(outcome.success).toBe(true);
		}
	});

	it('validates params against the schema of the named effect, not any other', () => {
		const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse({
			enabled: true,
			effect: 'fog',
			opacity: 0.5,
			params: { lightColor: '#7dd3fc' },
		});
		expect(outcome.success).toBe(false);
	});

	it('refuses an effect outside the closed vocabulary rather than approximating it', () => {
		const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse({
			enabled: true,
			effect: 'waves',
			opacity: 0.5,
		});
		expect(outcome.success).toBe(false);
	});

	it('refuses the retired flat-bag shape, so a stored pre-rebuild config resets instead of misreading', () => {
		const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse(PRE_REBUILD_FLAT_BAG);
		expect(outcome.success).toBe(false);
	});
});

describe('storedFrameAnimationConfigSchema', () => {
	it('passes a current-shape config through untouched', () => {
		const config = { enabled: true, effect: 'fog', opacity: 0.5, params: { speed: 2 } };
		const outcome = storedFrameAnimationConfigSchema.safeParse(config);
		expect(outcome.success).toBe(true);
		expect(outcome.data).toMatchObject({ effect: 'fog', params: expect.objectContaining({ speed: 2 }) });
	});

	it('resets a pre-rebuild flat bag to no animation instead of refusing the write that carries it', () => {
		// Any layout edit re-sends the whole stored layout, so a stale animation
		// riding along must not block the edit (the reset ADR-0014 accepts).
		const outcome = storedFrameAnimationConfigSchema.safeParse(PRE_REBUILD_FLAT_BAG);
		expect(outcome.success).toBe(true);
		expect(outcome.data).toBeUndefined();
	});

	it('still refuses a current-shape config naming an effect outside the vocabulary', () => {
		const outcome = storedFrameAnimationConfigSchema.safeParse({
			enabled: true,
			effect: 'waves',
			opacity: 0.5,
		});
		expect(outcome.success).toBe(false);
	});
});
