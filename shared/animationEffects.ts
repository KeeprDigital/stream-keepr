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

export const ANIMATION_EFFECT_VALUES = ['caustics', 'cells', 'dots', 'fog', 'globe', 'halo', 'net', 'rings', 'ripple', 'waves'] as const;

export type AnimationEffectName = typeof ANIMATION_EFFECT_VALUES[number];

/** What a parameter's `.meta()` carries: the editor-facing facts Zod checks cannot. */
interface AnimationEffectParamMeta {
	label: string;
	control: 'color' | 'number' | 'toggle';
	step?: number;
	description?: string;
}

/** What one effect parameter's value can be, across every control kind. */
export type AnimationEffectParamValue = string | number | boolean;

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

function toggleParam(label: string, description: string, defaultValue: boolean) {
	return z.boolean()
		.default(defaultValue)
		.meta({ label, control: 'toggle', description } satisfies AnimationEffectParamMeta);
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
 * Dots: a drifting field of point sprites with slowly tumbling radial line
 * segments, ported from the retired fork under its old name. `backgroundColor`
 * survives for the same reason as waves' — the fork's base cleared the canvas
 * to it, and a dot field never covers the frame. `showLines` is the
 * catalogue's first toggle param. Defaults and ranges are the pre-rebuild
 * application's, including the dots-specific `spacing` fallback of 34 rather
 * than the shared bag's 16.
 */
export const dotsAnimationParamsSchema = z.strictObject({
	color: colorParam('Dot color', '#7c3aed'),
	color2: colorParam('Accent color', '#06b6d4'),
	backgroundColor: colorParam('Background color', '#111111'),
	size: numberParam('Dot size', { min: 0.5, max: 20, step: 0.5, default: 3 }),
	spacing: numberParam('Spacing', { min: 5, max: 100, step: 1, default: 34 }),
	showLines: toggleParam('Connecting lines', 'Render connecting line segments between dots.', true),
});

/**
 * Globe: a wireframe sphere with radial accents and pole lines turning over a
 * waving, line-strung point plane, ported from the retired fork under its old
 * name. Every param is read. Net's vertex-colour restoration applies here too —
 * the fork passed the removed `THREE.VertexColors` constant, so its connection
 * lines rendered flat white on air; the port enables vertex colours. One label
 * is corrected: the pre-rebuild editor called `size` "Point size", but the
 * fork only ever read it as the wireframe globe's radius scale.
 */
export const globeAnimationParamsSchema = z.strictObject({
	color: colorParam('Primary color', '#7c3aed'),
	color2: colorParam('Secondary color', '#06b6d4'),
	backgroundColor: colorParam('Background color', '#111111'),
	size: numberParam('Globe size', { min: 0.2, max: 5, step: 0.1, default: 1 }),
	points: numberParam('Point count', { min: 2, max: 30, step: 1, default: 10 }),
	maxDistance: numberParam('Connection distance', { min: 1, max: 80, step: 1, default: 22 }),
	spacing: numberParam('Spacing', { min: 2, max: 80, step: 1, default: 16 }),
	showDots: toggleParam('Point markers', 'Render point markers around the globe.', true),
});

/**
 * Net: a slowly orbiting point field strung with distance-faded connection
 * lines, ported from the retired fork under its old name. Every param is read:
 * `color` drives the lines and the point markers, `backgroundColor` the clear
 * colour and the line gradient's dark end, and the rest the field's
 * construction. One knowing restoration rides the port: the fork passed the
 * `THREE.VertexColors` constant that three had removed, so on air its
 * per-vertex line gradient silently degraded to flat default-white lines and
 * "Line color" coloured only the dots — proven by running the fork against
 * three 0.185 in unattended Chromium. The port enables vertex colours, so the
 * lines render the gradient the fork wrote and the label describes.
 */
export const netAnimationParamsSchema = z.strictObject({
	color: colorParam('Line color', '#7c3aed'),
	backgroundColor: colorParam('Background color', '#111111'),
	points: numberParam('Point count', { min: 2, max: 30, step: 1, default: 10 }),
	maxDistance: numberParam('Connection distance', { min: 1, max: 80, step: 1, default: 22 }),
	spacing: numberParam('Spacing', { min: 2, max: 80, step: 1, default: 16 }),
	showDots: toggleParam('Point markers', 'Render point markers at net intersections.', true),
});

/**
 * Rings: a tumbling stack of extruded arc segments in the fork's fixed
 * thirteen-colour palette, ported from the retired fork under its old name.
 * Only the background colour survives as a param: the fork's renderer sampled
 * its palette for every ring and never read the colour option, so the
 * pre-rebuild editor's "Ring color" picker was inert and drops with the port
 * (the halo precedent for declared-but-unread params). `backgroundColor`
 * survives under the waves rule — the fork's base cleared the canvas to it,
 * and the rings never cover the frame.
 */
export const ringsAnimationParamsSchema = z.strictObject({
	backgroundColor: colorParam('Background color', '#111111'),
});

/**
 * Waves: a lit, choppy water plane — the first mesh-backend port from the
 * retired fork, under its old name. `backgroundColor` survives the port even
 * though the mesh never reads it: the fork's base cleared the canvas to it,
 * and the water plane leaves the frame's far corners uncovered at low zoom, so
 * it is visible on air. Defaults and ranges are the pre-rebuild application's,
 * including the waves-specific `zoom` fallback of 0.85 rather than the shared
 * bag's 1.
 */
export const wavesAnimationParamsSchema = z.strictObject({
	color: colorParam('Wave color', '#7c3aed'),
	backgroundColor: colorParam('Background color', '#111111'),
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
export type DotsAnimationParams = z.output<typeof dotsAnimationParamsSchema>;
export type HaloAnimationParams = z.output<typeof haloAnimationParamsSchema>;
export type GlobeAnimationParams = z.output<typeof globeAnimationParamsSchema>;
export type NetAnimationParams = z.output<typeof netAnimationParamsSchema>;
export type RingsAnimationParams = z.output<typeof ringsAnimationParamsSchema>;
export type RippleAnimationParams = z.output<typeof rippleAnimationParamsSchema>;
export type WavesAnimationParams = z.output<typeof wavesAnimationParamsSchema>;

export interface AnimationEffectParamsMap {
	caustics: CausticsAnimationParams;
	cells: CellsAnimationParams;
	dots: DotsAnimationParams;
	fog: FogAnimationParams;
	globe: GlobeAnimationParams;
	halo: HaloAnimationParams;
	net: NetAnimationParams;
	rings: RingsAnimationParams;
	ripple: RippleAnimationParams;
	waves: WavesAnimationParams;
}

export const ANIMATION_EFFECT_CATALOGUE = {
	caustics: { label: 'Caustics', paramsSchema: causticsAnimationParamsSchema },
	cells: { label: 'Cells', paramsSchema: cellsAnimationParamsSchema },
	dots: { label: 'Dots', paramsSchema: dotsAnimationParamsSchema },
	fog: { label: 'Fog', paramsSchema: fogAnimationParamsSchema },
	globe: { label: 'Globe', paramsSchema: globeAnimationParamsSchema },
	halo: { label: 'Halo', paramsSchema: haloAnimationParamsSchema },
	net: { label: 'Net', paramsSchema: netAnimationParamsSchema },
	rings: { label: 'Rings', paramsSchema: ringsAnimationParamsSchema },
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
	control: 'color' | 'number' | 'toggle';
	min?: number;
	max?: number;
	step?: number;
	description?: string;
	defaultValue: AnimationEffectParamValue;
}

/**
 * The editor-facing view of one effect's schema, read from the schema itself so
 * a range or default changed there is the one the editor offers.
 */
export function animationEffectParamFields(effect: AnimationEffectName): AnimationEffectParamField[] {
	const schema = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema;
	const defaults = animationEffectDefaultParams(effect) as Record<string, AnimationEffectParamValue>;
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
			description: meta.description,
			defaultValue: defaults[key]!,
		};
	});
}

/**
 * One effect selection branch: the effect's name paired with that effect's own
 * params and nothing else. `.strictObject` so a bag from any other effect — or
 * from the retired pre-rebuild flat shape — is refused rather than half-read.
 */
const selectionBranches = {
	caustics: z.strictObject({ effect: z.literal('caustics'), params: causticsAnimationParamsSchema.optional() }),
	cells: z.strictObject({ effect: z.literal('cells'), params: cellsAnimationParamsSchema.optional() }),
	dots: z.strictObject({ effect: z.literal('dots'), params: dotsAnimationParamsSchema.optional() }),
	fog: z.strictObject({ effect: z.literal('fog'), params: fogAnimationParamsSchema.optional() }),
	globe: z.strictObject({ effect: z.literal('globe'), params: globeAnimationParamsSchema.optional() }),
	halo: z.strictObject({ effect: z.literal('halo'), params: haloAnimationParamsSchema.optional() }),
	net: z.strictObject({ effect: z.literal('net'), params: netAnimationParamsSchema.optional() }),
	rings: z.strictObject({ effect: z.literal('rings'), params: ringsAnimationParamsSchema.optional() }),
	ripple: z.strictObject({ effect: z.literal('ripple'), params: rippleAnimationParamsSchema.optional() }),
	waves: z.strictObject({ effect: z.literal('waves'), params: wavesAnimationParamsSchema.optional() }),
} satisfies Record<AnimationEffectName, z.ZodObject>;

/**
 * The host-neutral Animation Effect selection: which effect, with that effect's
 * own params. Discriminated on the effect so a selection can only ever carry
 * params the named effect declares.
 *
 * This is the part of an animation configuration every host shares. What a host
 * adds around it — the Frame's `enabled`/`opacity`, a Background Layer's own
 * enabled state and opacity — is the host's concern and lives on the host's
 * schema, which composes these branches rather than restating them.
 *
 * `params` is optional and may be sparse: every field defaults from the effect's
 * schema, so an absent bag means "as shipped" and survives new params being added.
 */
export const animationEffectSelectionSchema = z.discriminatedUnion('effect', [
	selectionBranches.caustics,
	selectionBranches.cells,
	selectionBranches.dots,
	selectionBranches.fog,
	selectionBranches.globe,
	selectionBranches.halo,
	selectionBranches.net,
	selectionBranches.rings,
	selectionBranches.ripple,
	selectionBranches.waves,
]);

/** The stored/authored selection shape: params sparse, defaults implied. */
export type AnimationEffectSelection = z.input<typeof animationEffectSelectionSchema>;

/**
 * A stored Animation Effect selection re-proven rather than trusted: the parsed
 * selection, or `null` for one naming an effect this build does not ship.
 * Callers treat `null` as "no animation" — the vocabulary refusal, applied at
 * render time (the Frame's `parseFrameAnimationConfig` is this rule plus the
 * Frame's own fields).
 */
export function parseAnimationEffectSelection(
	value: unknown,
): z.output<typeof animationEffectSelectionSchema> | null {
	const outcome = animationEffectSelectionSchema.safeParse(value);
	return outcome.success ? outcome.data : null;
}

const frameAnimationShape = {
	enabled: z.boolean(),
	opacity: z.number().min(0).max(1),
};

/**
 * The Feature Match Overlay Frame's animation configuration: the shared effect
 * selection plus the Frame's own `enabled` and `opacity`. Each branch is the
 * selection branch extended, so the Frame can never accept a selection the
 * shared schema would refuse — `.extend` keeps the branches strict, which is
 * what makes a stored pre-rebuild flat-bag config (recognisable by its retired
 * `mouseDrift*` fields) reset to defaults rather than being half-read (the
 * reset ADR-0014 accepts).
 */
export const featureMatchOverlayFrameAnimationConfigSchema = z.discriminatedUnion('effect', [
	selectionBranches.caustics.extend(frameAnimationShape),
	selectionBranches.cells.extend(frameAnimationShape),
	selectionBranches.dots.extend(frameAnimationShape),
	selectionBranches.fog.extend(frameAnimationShape),
	selectionBranches.globe.extend(frameAnimationShape),
	selectionBranches.halo.extend(frameAnimationShape),
	selectionBranches.net.extend(frameAnimationShape),
	selectionBranches.rings.extend(frameAnimationShape),
	selectionBranches.ripple.extend(frameAnimationShape),
	selectionBranches.waves.extend(frameAnimationShape),
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
