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
		expect(ANIMATION_EFFECT_VALUES).toEqual(['caustics', 'cells', 'dots', 'fog', 'globe', 'halo', 'net', 'rings', 'ripple', 'waves']);
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

	it('ports halo under the defaults the pre-rebuild application shipped', () => {
		// Only the params the halo fragment shader reads survive the port: the
		// fork's editor also offered color2, ringFactor, and rotationFactor,
		// which its halo shader declared and never referenced.
		expect(animationEffectDefaultParams('halo')).toEqual({
			baseColor: '#111111',
			backgroundColor: '#111111',
			amplitudeFactor: 1,
			size: 1,
			xOffset: 0,
			yOffset: 0,
			speed: 1,
		});
	});

	it('ports waves under the defaults the pre-rebuild application shipped', () => {
		// backgroundColor survives the port even though the mesh never reads it:
		// the fork's base cleared the canvas to it, and the water plane leaves the
		// frame's far corners uncovered at low zoom. The zoom default is the
		// pre-rebuild application's waves-specific fallback.
		expect(animationEffectDefaultParams('waves')).toEqual({
			color: '#7c3aed',
			backgroundColor: '#111111',
			shininess: 30,
			waveHeight: 20,
			waveSpeed: 1,
			zoom: 0.85,
		});
	});

	it('ports dots under the defaults the pre-rebuild application shipped', () => {
		// The catalogue's first toggle param: showLines is a boolean field, not a
		// number or colour. backgroundColor survives for the same reason as waves'
		// — the fork's base cleared the canvas to it, and a dot field never covers
		// the frame. The spacing default is the dots-specific fallback of 34, not
		// the shared bag's 16.
		expect(animationEffectDefaultParams('dots')).toEqual({
			color: '#7c3aed',
			color2: '#06b6d4',
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
		// All six params are read by the renderer: color drives the connection
		// lines and the point markers, backgroundColor the clear colour and the
		// line gradient's dark end, and the rest the field's construction.
		expect(animationEffectDefaultParams('net')).toEqual({
			color: '#7c3aed',
			backgroundColor: '#111111',
			points: 10,
			maxDistance: 22,
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
			color: '#7c3aed',
			color2: '#06b6d4',
			backgroundColor: '#111111',
			size: 1,
			points: 10,
			maxDistance: 22,
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
