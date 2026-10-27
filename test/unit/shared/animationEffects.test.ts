import type { z } from 'zod';
import type { AnimationEffectName, AnimationEffectParams } from '~~/shared/animationEffects';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	ANIMATION_EFFECT_CATALOGUE,
	ANIMATION_EFFECT_VALUES,
	animationEffectDefaultParams,
	animationEffectParamFields,
	animationEffectSelectionSchema,
	broadcastGraphicsBackgroundConfigSchema,
	featureMatchOverlayFrameAnimationConfigSchema,
	parseAnimationEffectSelection,
	parseBroadcastGraphicsBackgroundConfig,
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
		expect(ANIMATION_EFFECT_VALUES).toEqual([
			'caustics',
			'cells',
			'dots',
			'ember',
			'fog',
			'globe',
			'halo',
			'inkmap',
			'net',
			'ridgelines',
			'rings',
			'ripple',
			'shards',
			'waves',
			'weave',
		]);
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
		// Rings carries no number param — its schema is a background colour alone.
		const effectsWithNumbers = ANIMATION_EFFECT_VALUES.filter(effect =>
			animationEffectParamFields(effect).some(field => field.control === 'number'));
		expect(effectsWithNumbers).toEqual(ANIMATION_EFFECT_VALUES.filter(effect => effect !== 'rings'));
		for (const effect of effectsWithNumbers) {
			const [numberField] = animationEffectParamFields(effect).filter(field => field.control === 'number');
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

	it('names every spatial param by the catalogue\'s standard', () => {
		// One meaning per name across effects (ADR-0025, #503): `scale` for a
		// field's feature size, defaulting to the designed look; `size` for a
		// discrete element. No `zoom`, and no qualified variants of either.
		for (const effect of ANIMATION_EFFECT_VALUES) {
			for (const field of animationEffectParamFields(effect)) {
				if (field.key === 'scale') {
					expect(field.label, `${effect}.scale`).toMatch(/^\S+ scale$/);
					expect(field.defaultValue, `${effect}.scale`).toBe(1);
				}
				else if (field.key === 'size') {
					expect(field.label, `${effect}.size`).toMatch(/^\S+ size$/);
				}
				else {
					expect(field.key, effect).not.toMatch(/zoom|scale|size/i);
				}
			}
		}
	});

	it('names every param by what it controls, never by the fork\'s shader quantity', () => {
		// One rule across the catalogue (ADR-0025, #583): semantic names, colours
		// named by the role they paint, shared concepts under the shared name.
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const fields = animationEffectParamFields(effect);
			const keys = fields.map(field => field.key);
			for (const field of fields) {
				const where = `${effect}.${field.key}`;
				// No implementation multipliers (`amplitudeFactor`) or numbered keys
				// (`color1`, `color2`).
				expect(field.key, where).not.toMatch(/Factor$|\d/);
				// Pattern position is `centerX`/`centerY`, not a second name for it.
				expect(field.key, where).not.toMatch(/offset/i);
				if (field.control === 'color') {
					// `<role>Color`, so a bare `color` is refused, labelled "<Role> color".
					expect(field.key, where).toMatch(/^[a-z]+Color$/);
					const role = field.key.slice(0, -'Color'.length);
					expect(field.label, where).toBe(`${role[0]!.toUpperCase()}${role.slice(1)} color`);
				}
				else {
					expect(field.key, where).not.toMatch(/Color$/);
				}
				if (field.control === 'toggle') {
					// `show<Thing>`, naming the same thing its label does: net's and
					// globe's markers sit on their `points`, so `showPoints`.
					expect(field.key, where).toMatch(/^show[A-Z][a-z]+$/);
					const thing = field.key.slice('show'.length).toLowerCase().replace(/s$/, '');
					expect(field.label.toLowerCase(), where).toContain(thing);
				}
				// `speed` is an effect's whole motion rate and is never qualified; a
				// `<motion>Speed` is only ever a second rate beside it.
				if (field.key !== 'speed' && field.key.endsWith('Speed'))
					expect(keys, where).toContain('speed');
			}
		}
	});

	it('refuses a parameter no effect schema declares', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const outcome = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.safeParse({ mouseDriftEnabled: true });
			expect(outcome.success).toBe(false);
		}
	});
});

describe('animationEffectSelectionSchema', () => {
	it('accepts a sparse selection for every effect and leaves the params sparse', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const outcome = animationEffectSelectionSchema.safeParse({ effect });
			expect(outcome.success).toBe(true);
			expect(outcome.data).toEqual({ effect });
		}
	});

	it('validates params against the schema of the named effect, not any other', () => {
		const outcome = animationEffectSelectionSchema.safeParse({
			effect: 'fog',
			params: { lightColor: '#7dd3fc' },
		});
		expect(outcome.success).toBe(false);
	});

	it('refuses an effect outside the closed vocabulary rather than approximating it', () => {
		const outcome = animationEffectSelectionSchema.safeParse({ effect: 'not-an-effect' });
		expect(outcome.success).toBe(false);
	});

	it('carries no host concerns: enabled and opacity belong to the host, not the selection', () => {
		const outcome = animationEffectSelectionSchema.safeParse({
			effect: 'fog',
			enabled: true,
			opacity: 0.5,
		});
		expect(outcome.success).toBe(false);
	});

	it('re-proves a stored selection: parsed through, or null for anything this build does not ship', () => {
		expect(parseAnimationEffectSelection({
			effect: 'fog',
			params: { speed: 2 },
		}))
			.toMatchObject({
				effect: 'fog',
				params: expect.objectContaining({ speed: 2, softness: 0.55 }),
			});
		expect(parseAnimationEffectSelection({ effect: 'not-an-effect' })).toBeNull();
		expect(parseAnimationEffectSelection(undefined)).toBeNull();
	});
});

describe('animation effect host unions', () => {
	it('pairs each effect with its own params, and only those, in every union', () => {
		// Checked by `pnpm typecheck`: the per-effect pairing is the property a
		// derived declaration could silently collapse into one wide union.
		interface Rings { backgroundColor: string }
		interface Cells { lowlightColor: string; highlightColor: string; scale: number; speed: number }
		expectTypeOf<'not-an-effect'>().not.toExtend<AnimationEffectName>();
		expectTypeOf<AnimationEffectParams<'rings'>>().toEqualTypeOf<Rings>();
		expectTypeOf<AnimationEffectParams<'cells'>>().toEqualTypeOf<Cells>();

		type Selection = z.output<typeof animationEffectSelectionSchema>;
		type Background = z.output<typeof broadcastGraphicsBackgroundConfigSchema>;
		expectTypeOf<Extract<Selection, { effect: 'rings' }>>().toEqualTypeOf<{ effect: 'rings'; params?: Rings | undefined }>();
		expectTypeOf<Extract<Background, { effect: 'rings' }>>().toEqualTypeOf<{ effect: 'rings'; params?: Rings | undefined; enabled: boolean; opacity: number }>();
	});

	it('covers the whole catalogue in every host union, in catalogue order', () => {
		// Every host union is mapped from the catalogue; an effect missing from one
		// would be an effect that silently cannot be selected on that host.
		expect(broadcastGraphicsBackgroundConfigSchema.options.map(branch => branch.shape.effect.value)).toEqual([...ANIMATION_EFFECT_VALUES]);
	});

	it('fills each effect\'s params from that effect\'s own schema in every union', () => {
		// The branch list is asserted to its per-effect type, so this is what proves
		// the runtime pairing the type claims.
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const expected = animationEffectDefaultParams(effect);
			expect(animationEffectSelectionSchema.parse({ effect, params: {} }).params).toEqual(expected);
			expect(broadcastGraphicsBackgroundConfigSchema.parse({
				effect,
				params: {},
				enabled: true,
				opacity: 1,
			}).params).toEqual(expected);
		}
	});
});

describe('featureMatchOverlayFrameAnimationConfigSchema', () => {
	// The Frame's effect is its Theme's `frame-animation-effect` Mode Token (#831).
	it.each(ANIMATION_EFFECT_VALUES)('reads a layout stored with its own %s effect and params as its switch and opacity alone', (effect) => {
		const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse({
			enabled: true,
			effect,
			opacity: 0.5,
			params: { speed: 2 },
		});
		expect(outcome.data).toEqual({ enabled: true, opacity: 0.5 });
	});

	it('refuses an effect outside the closed vocabulary, which no stored layout held', () => {
		const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse({
			enabled: true,
			effect: 'not-an-effect',
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
	it('passes a current-shape config through', () => {
		const outcome = storedFrameAnimationConfigSchema.safeParse({ enabled: true, opacity: 0.5 });
		expect(outcome.data).toEqual({ enabled: true, opacity: 0.5 });
	});

	it('resets a pre-rebuild flat bag to no animation instead of refusing the write that carries it', () => {
		// Any layout edit re-sends the whole stored layout, so a stale animation
		// riding along must not block the edit (the reset ADR-0014 accepts).
		const outcome = storedFrameAnimationConfigSchema.safeParse(PRE_REBUILD_FLAT_BAG);
		expect(outcome.success).toBe(true);
		expect(outcome.data).toBeUndefined();
	});
});

describe('broadcastGraphicsBackgroundConfigSchema', () => {
	it('accepts a sparse config for every effect and leaves the params sparse', () => {
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const outcome = broadcastGraphicsBackgroundConfigSchema.safeParse({
				enabled: true,
				effect,
				opacity: 0.5,
			});
			expect(outcome.success).toBe(true);
			expect(outcome.data).toEqual({ enabled: true, effect, opacity: 0.5 });
		}
	});

	it('validates params against the schema of the named effect, not any other', () => {
		const outcome = broadcastGraphicsBackgroundConfigSchema.safeParse({
			enabled: true,
			effect: 'fog',
			opacity: 0.5,
			params: { lightColor: '#7dd3fc' },
		});
		expect(outcome.success).toBe(false);
	});

	it('refuses an effect outside the closed vocabulary rather than approximating it', () => {
		const outcome = broadcastGraphicsBackgroundConfigSchema.safeParse({
			enabled: true,
			effect: 'not-an-effect',
			opacity: 0.5,
		});
		expect(outcome.success).toBe(false);
	});

	it('carries the host fields the Screen needs, and refuses one it does not declare', () => {
		expect(broadcastGraphicsBackgroundConfigSchema.safeParse({ effect: 'fog', opacity: 0.5 }).success).toBe(false);
		expect(broadcastGraphicsBackgroundConfigSchema.safeParse({ effect: 'fog', enabled: true }).success).toBe(false);
		expect(broadcastGraphicsBackgroundConfigSchema.safeParse({
			enabled: true,
			effect: 'fog',
			opacity: 0.5,
			fit: 'cover',
		}).success).toBe(false);
	});

	it('holds opacity to the same nought-to-one range every host reads it as', () => {
		expect(broadcastGraphicsBackgroundConfigSchema.safeParse({ enabled: true, effect: 'fog', opacity: 1.5 }).success).toBe(false);
		expect(broadcastGraphicsBackgroundConfigSchema.safeParse({ enabled: true, effect: 'fog', opacity: -0.1 }).success).toBe(false);
	});

	it('re-proves a stored background: parsed through with defaults filled, or null for anything this build does not ship', () => {
		expect(parseBroadcastGraphicsBackgroundConfig({
			enabled: true,
			effect: 'fog',
			opacity: 0.4,
			params: { speed: 2 },
		}))
			.toMatchObject({
				enabled: true,
				effect: 'fog',
				opacity: 0.4,
				params: expect.objectContaining({ speed: 2, softness: 0.55 }),
			});
		expect(parseBroadcastGraphicsBackgroundConfig({ enabled: true, effect: 'not-an-effect', opacity: 0.4 })).toBeNull();
		expect(parseBroadcastGraphicsBackgroundConfig(undefined)).toBeNull();
	});
});
