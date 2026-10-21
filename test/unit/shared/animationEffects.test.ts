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
		expect(ANIMATION_EFFECT_VALUES).toEqual(['caustics', 'cells', 'dots', 'ember', 'fog', 'globe', 'halo', 'inkmap', 'net', 'ridgelines', 'rings', 'ripple', 'shards', 'waves', 'weave']);
	});

	it('ships ridgelines under its designed defaults', () => {
		// A new effect (no fork ancestry): semantic param names, defaults from the
		// recorded design spec on #473.
		expect(animationEffectDefaultParams('ridgelines')).toEqual({
			crestColor: '#06b6d4',
			ridgeColor: '#1e1b4b',
			backgroundColor: '#111111',
			ridges: 7,
			relief: 1,
			glow: 1,
			speed: 1,
		});
	});

	it('ships weave under its designed defaults', () => {
		// A new effect (no fork ancestry): semantic param names, defaults from the
		// recorded design spec on #473.
		expect(animationEffectDefaultParams('weave')).toEqual({
			warpColor: '#7c3aed',
			weftColor: '#06b6d4',
			backgroundColor: '#111111',
			scale: 1,
			thickness: 0.6,
			sheen: 1,
			speed: 1,
		});
	});

	it('ships inkmap under its designed defaults', () => {
		// A new effect (no fork ancestry): semantic param names, defaults from the
		// recorded design spec on #473.
		expect(animationEffectDefaultParams('inkmap')).toEqual({
			inkColor: '#312e81',
			edgeColor: '#06b6d4',
			backgroundColor: '#111111',
			coverage: 0.5,
			contours: 4,
			scale: 1,
			speed: 1,
		});
	});

	it('ships shards under its designed defaults', () => {
		// A new effect (no fork ancestry): semantic param names, defaults from the
		// recorded design spec on #473.
		expect(animationEffectDefaultParams('shards')).toEqual({
			shardColor: '#312e81',
			edgeColor: '#7dd3fc',
			backgroundColor: '#111111',
			scale: 1,
			intensity: 1,
			speed: 1,
		});
	});

	it('ships ember under its designed defaults', () => {
		// The first new effect after the ports: no fork ancestry, so the params
		// carry semantic names (the caustics precedent) and the defaults are the
		// recorded design's, not a pre-rebuild bag's.
		expect(animationEffectDefaultParams('ember')).toEqual({
			emberColor: '#f97316',
			coreColor: '#fef3c7',
			backgroundColor: '#111111',
			density: 1,
			size: 1,
			intensity: 1,
			speed: 1,
		});
	});

	it('ports cells and ripple under the defaults the pre-rebuild application shipped', () => {
		// The ports keep their old names and their old on-air look: defaults come
		// from the retired editor's shared bag, not the fork's own defaultOptions.
		// Cells' `size` of 3 is renormalised into `scale: 1` (#503), and the
		// fork's numbered colours and multipliers carry semantic names (#583).
		expect(animationEffectDefaultParams('cells')).toEqual({
			lowlightColor: '#008c8c',
			highlightColor: '#06b6d4',
			scale: 1,
			speed: 0.6,
		});
		expect(animationEffectDefaultParams('ripple')).toEqual({
			highlightColor: '#008c8c',
			lowlightColor: '#06b6d4',
			backgroundColor: '#111111',
			size: 1,
			swingSpeed: 1,
			drift: 1,
			centerX: 0,
			centerY: 0,
			frequency: 1,
			speed: 0.6,
		});
		expect(animationEffectParamFields('ripple')).toEqual(expect.arrayContaining([
			// The fork's "Ripple scale" scaled no feature: it sets how fast each
			// ring's lights swing back and forth round it.
			expect.objectContaining({ key: 'swingSpeed', label: 'Swing speed', min: 0, max: 12 }),
			expect.objectContaining({ key: 'size', label: 'Ring size', min: 0, max: 4 }),
			expect.objectContaining({ key: 'drift', label: 'Ring drift', min: 0, max: 4 }),
			expect.objectContaining({ key: 'centerX', label: 'Center X', min: -1, max: 1 }),
			expect.objectContaining({ key: 'centerY', label: 'Center Y', min: -1, max: 1 }),
			expect.objectContaining({ key: 'frequency', label: 'Ripple frequency', min: 0, max: 4 }),
		]));
	});

	it('ports halo under the defaults the pre-rebuild application shipped', () => {
		// Only the params the halo fragment shader reads survive the port: the
		// fork's editor also offered a second colour and two multipliers,
		// which its halo shader declared and never referenced. Its "Intensity"
		// deepened the flower edge's petals, so it is `petalDepth` (#583).
		expect(animationEffectDefaultParams('halo')).toEqual({
			tintColor: '#111111',
			backgroundColor: '#111111',
			petalDepth: 1,
			size: 1,
			centerX: 0,
			centerY: 0,
			speed: 1,
		});
	});

	it('ports waves under the defaults the pre-rebuild application shipped', () => {
		// backgroundColor survives the port even though the mesh never reads it:
		// the fork's base cleared the canvas to it, and the water plane leaves the
		// frame's far corners uncovered at low scale. Scale 1 is the pre-rebuild
		// application's waves-specific zoom fallback of 0.85 (#503).
		expect(animationEffectDefaultParams('waves')).toEqual({
			waveColor: '#7c3aed',
			backgroundColor: '#111111',
			shininess: 30,
			waveHeight: 20,
			speed: 1,
			scale: 1,
		});
	});

	it('ports dots under the defaults the pre-rebuild application shipped', () => {
		// The catalogue's first toggle param: showLines is a boolean field, not a
		// number or colour. backgroundColor survives for the same reason as waves'
		// — the fork's base cleared the canvas to it, and a dot field never covers
		// the frame. The spacing default is the dots-specific fallback of 34, not
		// the shared bag's 16.
		expect(animationEffectDefaultParams('dots')).toEqual({
			dotColor: '#7c3aed',
			lineColor: '#06b6d4',
			backgroundColor: '#111111',
			size: 3,
			spacing: 34,
			showLines: true,
		});
		const showLines = animationEffectParamFields('dots').find(field => field.key === 'showLines');
		expect(showLines).toMatchObject({
			control: 'toggle',
			defaultValue: true,
			description: 'Render connecting line segments between dots.',
		});
		expect(showLines?.min).toBeUndefined();
		expect(showLines?.step).toBeUndefined();
	});

	it('ports rings with only the background colour, as the pre-rebuild application rendered it', () => {
		// The fork's rings renderer samples a hardcoded palette for every ring
		// and never reads the colour option, so the pre-rebuild editor's "Ring
		// color" picker was inert and drops with the port (the halo precedent for
		// declared-but-unread params). backgroundColor survives under the waves
		// rule: the fork's base cleared the canvas to it, and the rings never
		// cover the frame.
		expect(animationEffectDefaultParams('rings')).toEqual({
			backgroundColor: '#111111',
		});
	});

	it('ports net under the defaults the pre-rebuild application shipped', () => {
		// All six params are read by the renderer: lineColor drives the connection
		// lines and the point markers, backgroundColor the clear colour and the
		// line gradient's dark end, and the rest the field's construction.
		expect(animationEffectDefaultParams('net')).toEqual({
			lineColor: '#7c3aed',
			backgroundColor: '#111111',
			points: 10,
			connectionDistance: 22,
			spacing: 16,
			showDots: true,
		});
		const showDots = animationEffectParamFields('net').find(field => field.key === 'showDots');
		expect(showDots).toMatchObject({
			control: 'toggle',
			defaultValue: true,
			description: 'Render point markers at net intersections.',
		});
	});

	it('ports globe under the defaults the pre-rebuild application shipped', () => {
		// Every param is read by the renderer. One label is corrected in the
		// port: the pre-rebuild editor called `size` "Point size", but the fork
		// only ever read it as the wireframe globe's radius scale.
		expect(animationEffectDefaultParams('globe')).toEqual({
			lineColor: '#7c3aed',
			accentColor: '#06b6d4',
			backgroundColor: '#111111',
			size: 1,
			points: 10,
			connectionDistance: 22,
			spacing: 16,
			showDots: true,
		});
		const fields = animationEffectParamFields('globe');
		expect(fields.find(field => field.key === 'size')?.label).toBe('Globe size');
		expect(fields.find(field => field.key === 'showDots')).toMatchObject({
			control: 'toggle',
			defaultValue: true,
			description: 'Render point markers around the globe.',
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
		expect(parseAnimationEffectSelection({ effect: 'fog', params: { speed: 2 } }))
			.toMatchObject({ effect: 'fog', params: expect.objectContaining({ speed: 2, softness: 0.55 }) });
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
		type Frame = z.output<typeof featureMatchOverlayFrameAnimationConfigSchema>;
		type Background = z.output<typeof broadcastGraphicsBackgroundConfigSchema>;
		expectTypeOf<Extract<Selection, { effect: 'rings' }>>().toEqualTypeOf<{ effect: 'rings'; params?: Rings | undefined }>();
		expectTypeOf<Extract<Frame, { effect: 'cells' }>>().toEqualTypeOf<{ effect: 'cells'; params?: Cells | undefined; enabled: boolean; opacity: number }>();
		expectTypeOf<Extract<Background, { effect: 'rings' }>>().toEqualTypeOf<{ effect: 'rings'; params?: Rings | undefined; enabled: boolean; opacity: number }>();
	});

	it('covers the whole catalogue in every host union, in catalogue order', () => {
		// Every host union is mapped from the catalogue; an effect missing from one
		// would be an effect that silently cannot be selected on that host.
		for (const schema of [featureMatchOverlayFrameAnimationConfigSchema, broadcastGraphicsBackgroundConfigSchema]) {
			expect(schema.options.map(branch => branch.shape.effect.value)).toEqual([...ANIMATION_EFFECT_VALUES]);
		}
	});

	it('fills each effect\'s params from that effect\'s own schema in every union', () => {
		// The branch list is asserted to its per-effect type, so this is what proves
		// the runtime pairing the type claims.
		for (const effect of ANIMATION_EFFECT_VALUES) {
			const expected = animationEffectDefaultParams(effect);
			expect(animationEffectSelectionSchema.parse({ effect, params: {} }).params).toEqual(expected);
			for (const schema of [featureMatchOverlayFrameAnimationConfigSchema, broadcastGraphicsBackgroundConfigSchema])
				expect(schema.parse({ effect, params: {}, enabled: true, opacity: 1 }).params).toEqual(expected);
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
			effect: 'not-an-effect',
			opacity: 0.5,
		});
		expect(outcome.success).toBe(false);
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
		expect(parseBroadcastGraphicsBackgroundConfig({ enabled: true, effect: 'fog', opacity: 0.4, params: { speed: 2 } }))
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
