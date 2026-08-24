import { z } from 'zod';

/**
 * The Animation Effect catalogue: the closed vocabulary of animated background
 * renderers that ship with Stream Keepr, and one Zod schema per effect as the
 * single source of truth for that effect's parameters, ranges, and defaults.
 *
 * Everything any consumer knows about an effect's configuration is derived from
 * its schema here: the server validates writes with it, the renderer parses
 * stored params through it (falling back to defaults when a stored config
 * predates the effect's current shape), and the editor renders its fields from
 * the descriptors `animationEffectParamFields` reads off it. The vendored fork
 * this replaced kept one flat parameter bag whose ranges lived in three copies —
 * a Zod schema, a runtime clamp, and the editor's field bounds — which had
 * already diverged; deriving all three from one schema is what this module is
 * for (ADR-0014, #473).
 *
 * The vocabulary is closed for the same reason a Source Role's is: an effect
 * names a renderer this application ships, so a config or Template Package
 * naming one an installation does not implement is refused rather than
 * approximated. Ports from the retired fork rejoin this list under their old
 * names as they land; until then the vocabulary is exactly what renders.
 */

export const ANIMATION_EFFECT_VALUES = ['caustics', 'cells', 'fog', 'halo', 'ripple', 'waves'] as const;

export type AnimationEffectName = typeof ANIMATION_EFFECT_VALUES[number];

/** What a parameter's `.meta()` carries: the editor-facing facts Zod checks cannot. */
interface AnimationEffectParamMeta {
	label: string;
	control: 'color' | 'number';
	step?: number;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Whether a string is a colour an effect param accepts (see `colorParam`). */
export function isAnimationEffectHexColor(value: string): boolean {
	return HEX_COLOR_PATTERN.test(value);
}

/**
 * Effect colours are hex-only, unlike the looser CSS colour strings elsewhere in
 * a Screen configuration: each one becomes a shader uniform via `THREE.Color`,
 * which silently misreads anything richer, and the colour picker emits hex.
 */
function colorParam(label: string, defaultValue: string) {
	return z.string()
		.regex(HEX_COLOR_PATTERN, 'Expected a hex colour such as #06b6d4')
		.default(defaultValue)
		.meta({ label, control: 'color' } satisfies AnimationEffectParamMeta);
}

function numberParam(label: string, range: { min: number; max: number; step: number; default: number }) {
	return z.number()
		.min(range.min)
		.max(range.max)
		.default(range.default)
		.meta({ label, control: 'number', step: range.step } satisfies AnimationEffectParamMeta);
}

/**
 * Fog: the fbm domain-warp shader ported from the retired fork under its old
 * name, minus the mouse uniform nothing on a headless browser source ever fed.
 */
export const fogAnimationParamsSchema = z.strictObject({
	highlightColor: colorParam('Highlight color', '#f59e0b'),
	midtoneColor: colorParam('Midtone color', '#7c3aed'),
	lowlightColor: colorParam('Lowlight color', '#06b6d4'),
	baseColor: colorParam('Base color', '#111111'),
	blurFactor: numberParam('Softness', { min: 0.1, max: 0.95, step: 0.05, default: 0.55 }),
	speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 0.6 }),
	zoom: numberParam('Zoom', { min: 0.5, max: 3, step: 0.1, default: 1 }),
});

/**
 * Cells: a Worley-noise cellular field, ported from the retired fork under its
 * old name. Only the params the fragment shader reads survive the port: the
 * fork's editor also offered `amplitudeFactor`, `ringFactor`, `rotationFactor`,
 * and a background colour that its cells shader declared but never referenced.
 * Defaults are the pre-rebuild application's, not the fork's.
 */
export const cellsAnimationParamsSchema = z.strictObject({
	color1: colorParam('Primary color', '#008c8c'),
	color2: colorParam('Secondary color', '#06b6d4'),
	size: numberParam('Cell size', { min: 0.2, max: 5, step: 0.1, default: 3 }),
	speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 0.6 }),
});

/**
 * Ripple: rings of orbiting lights accumulating over a background colour,
 * ported from the retired fork under its old name and the pre-rebuild
 * application's defaults.
 */
export const rippleAnimationParamsSchema = z.strictObject({
	color1: colorParam('Primary color', '#008c8c'),
	color2: colorParam('Secondary color', '#06b6d4'),
	backgroundColor: colorParam('Background color', '#111111'),
	amplitudeFactor: numberParam('Intensity', { min: 0, max: 4, step: 0.1, default: 1 }),
	ringFactor: numberParam('Ripple scale', { min: 0, max: 12, step: 0.1, default: 1 }),
	rotationFactor: numberParam('Rotation', { min: 0, max: 4, step: 0.1, default: 1 }),
	speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 0.6 }),
});

/**
 * Halo: a flower-edged ring of cycling hues smearing through a feedback
 * buffer, ported from the retired fork under its old name. Only the params the
 * fragment shader reads survive the port: the fork's editor also offered
 * `color2`, `ringFactor`, and `rotationFactor`, which its halo shader declared
 * and never referenced. Defaults are the pre-rebuild application's.
 */
export const haloAnimationParamsSchema = z.strictObject({
	baseColor: colorParam('Base color', '#111111'),
	backgroundColor: colorParam('Background color', '#111111'),
	amplitudeFactor: numberParam('Intensity', { min: 0, max: 4, step: 0.1, default: 1 }),
	size: numberParam('Size', { min: 0.2, max: 5, step: 0.1, default: 1 }),
	xOffset: numberParam('Horizontal offset', { min: -1, max: 1, step: 0.05, default: 0 }),
	yOffset: numberParam('Vertical offset', { min: -1, max: 1, step: 0.05, default: 0 }),
	speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
});

/**
 * Waves: a lit, choppy water plane — the first mesh-backend port from the
 * retired fork, under its old name. Only the params the waves renderer reads
 * survive: the fork's editor also offered a background colour its mesh never
 * referenced. Defaults and ranges are the pre-rebuild application's, including
 * the waves-specific `zoom` fallback of 0.85 rather than the shared bag's 1.
 */
export const wavesAnimationParamsSchema = z.strictObject({
	color: colorParam('Wave color', '#7c3aed'),
	shininess: numberParam('Shine', { min: 0, max: 100, step: 1, default: 30 }),
	waveHeight: numberParam('Wave height', { min: 0, max: 50, step: 1, default: 20 }),
	waveSpeed: numberParam('Wave speed', { min: 0, max: 4, step: 0.1, default: 1 }),
	zoom: numberParam('Zoom', { min: 0.5, max: 3, step: 0.1, default: 0.85 }),
});

/** Caustics: refracted-light interference drifting over a water colour. */
export const causticsAnimationParamsSchema = z.strictObject({
	lightColor: colorParam('Light color', '#7dd3fc'),
	waterColor: colorParam('Water color', '#083344'),
	intensity: numberParam('Intensity', { min: 0, max: 2, step: 0.05, default: 1 }),
	speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
	zoom: numberParam('Zoom', { min: 0.5, max: 3, step: 0.1, default: 1 }),
});

/** Fully-defaulted params, as an effect renderer receives them. */
export type FogAnimationParams = z.output<typeof fogAnimationParamsSchema>;
export type CausticsAnimationParams = z.output<typeof causticsAnimationParamsSchema>;
export type CellsAnimationParams = z.output<typeof cellsAnimationParamsSchema>;
export type HaloAnimationParams = z.output<typeof haloAnimationParamsSchema>;
export type RippleAnimationParams = z.output<typeof rippleAnimationParamsSchema>;
export type WavesAnimationParams = z.output<typeof wavesAnimationParamsSchema>;

export interface AnimationEffectParamsMap {
	caustics: CausticsAnimationParams;
	cells: CellsAnimationParams;
	fog: FogAnimationParams;
	halo: HaloAnimationParams;
	ripple: RippleAnimationParams;
	waves: WavesAnimationParams;
}

export const ANIMATION_EFFECT_CATALOGUE = {
	caustics: { label: 'Caustics', paramsSchema: causticsAnimationParamsSchema },
	cells: { label: 'Cells', paramsSchema: cellsAnimationParamsSchema },
	fog: { label: 'Fog', paramsSchema: fogAnimationParamsSchema },
	halo: { label: 'Halo', paramsSchema: haloAnimationParamsSchema },
	ripple: { label: 'Ripple', paramsSchema: rippleAnimationParamsSchema },
	waves: { label: 'Waves', paramsSchema: wavesAnimationParamsSchema },
} satisfies Record<AnimationEffectName, { label: string; paramsSchema: z.ZodObject }>;

export function animationEffectDefaultParams<Effect extends AnimationEffectName>(
	effect: Effect,
): AnimationEffectParamsMap[Effect] {
	return ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.parse({}) as AnimationEffectParamsMap[Effect];
}

/** One effect parameter as the editor renders it: control kind, bounds, and starting value. */
export interface AnimationEffectParamField {
	key: string;
	label: string;
	control: 'color' | 'number';
	min?: number;
	max?: number;
	step?: number;
	defaultValue: string | number;
}

/**
 * The editor-facing view of one effect's schema, read from the schema itself so
 * a range or default changed there is the one the editor offers.
 */
export function animationEffectParamFields(effect: AnimationEffectName): AnimationEffectParamField[] {
	const schema = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema;
	const defaults = animationEffectDefaultParams(effect) as Record<string, string | number>;
	return Object.entries(schema.shape).map(([key, field]) => {
		const meta = field.meta() as unknown as AnimationEffectParamMeta;
		// Every param is `.default()`-wrapped, so the checks live one level in.
		const inner = (field as z.ZodDefault).def.innerType;
		const bounds = inner instanceof z.ZodNumber
			? { min: inner.minValue ?? undefined, max: inner.maxValue ?? undefined }
			: {};
		return {
			key,
			label: meta.label,
			control: meta.control,
			...bounds,
			step: meta.step,
			defaultValue: defaults[key]!,
		};
	});
}

const frameAnimationShape = {
	enabled: z.boolean(),
	opacity: z.number().min(0).max(1),
};

/**
 * The Feature Match Overlay Frame's animation configuration: which effect, at
 * what opacity, with that effect's own params. Discriminated on the effect so a
 * config can only ever carry params the named effect declares, and `.strict()`
 * throughout so a stored pre-rebuild flat-bag config — which always carried the
 * retired `mouseDrift*` fields — is refused and resets to defaults rather than
 * being half-read (the reset ADR-0014 accepts).
 *
 * `params` is optional and may be sparse: every field defaults from the effect's
 * schema, so an absent bag means "as shipped" and survives new params being added.
 */
export const featureMatchOverlayFrameAnimationConfigSchema = z.discriminatedUnion('effect', [
	z.strictObject({
		...frameAnimationShape,
		effect: z.literal('caustics'),
		params: causticsAnimationParamsSchema.optional(),
	}),
	z.strictObject({
		...frameAnimationShape,
		effect: z.literal('cells'),
		params: cellsAnimationParamsSchema.optional(),
	}),
	z.strictObject({
		...frameAnimationShape,
		effect: z.literal('fog'),
		params: fogAnimationParamsSchema.optional(),
	}),
	z.strictObject({
		...frameAnimationShape,
		effect: z.literal('halo'),
		params: haloAnimationParamsSchema.optional(),
	}),
	z.strictObject({
		...frameAnimationShape,
		effect: z.literal('ripple'),
		params: rippleAnimationParamsSchema.optional(),
	}),
	z.strictObject({
		...frameAnimationShape,
		effect: z.literal('waves'),
		params: wavesAnimationParamsSchema.optional(),
	}),
]);

/**
 * The stored/authored shape: params sparse, defaults implied. Renderers parse it
 * through the schema to get the fully-defaulted `AnimationEffectParamsMap` form.
 */
export type FeatureMatchOverlayFrameAnimationConfig = z.input<typeof featureMatchOverlayFrameAnimationConfigSchema>;

/**
 * A stored `frame.animation` value re-proven rather than trusted, for the
 * consumers that read one: the parsed config, or `null` for anything else — a
 * config that predates the in-house Animation Effect rebuild, or one naming an
 * effect this build does not ship. Callers treat `null` as "no animation"
 * (renderer) or start over from defaults (editor), which is the "reset, not
 * migrated" ADR-0014 accepts.
 */
export function parseFrameAnimationConfig(
	value: unknown,
): z.output<typeof featureMatchOverlayFrameAnimationConfigSchema> | null {
	const outcome = featureMatchOverlayFrameAnimationConfigSchema.safeParse(value);
	return outcome.success ? outcome.data : null;
}

/**
 * The retired pre-rebuild shape, recognisable by the `mouseDrift*` fields every
 * stored flat-bag config was required to carry. Matched only to be reset: the
 * fields themselves are never read.
 */
const retiredFrameAnimationConfigSchema = z.looseObject({
	enabled: z.boolean(),
	effect: z.string().max(100),
	opacity: z.number(),
	mouseDriftEnabled: z.boolean(),
	mouseDriftSeconds: z.number(),
	mouseDriftRadius: z.number(),
});

/**
 * What a write path accepts for a stored `frame.animation` payload.
 *
 * Every Feature Match Layout write re-sends the whole stored layout — a border
 * tweak, a Source Item move, a composition edit all carry `frame.animation`
 * along — so a stale pre-rebuild bag must not veto the unrelated edit it rides
 * on. This wrapper parses a current-shape config through unchanged and resolves
 * a recognisably pre-rebuild one to `undefined`, which is the "reset, not
 * migrated" ADR-0014 accepts, applied at the first write that touches the
 * layout. A current-shape config naming an unknown effect still fails both
 * branches: that is a vocabulary refusal, not a legacy reset.
 */
export const storedFrameAnimationConfigSchema = z.union([
	featureMatchOverlayFrameAnimationConfigSchema,
	retiredFrameAnimationConfigSchema.transform(() => undefined),
]);
