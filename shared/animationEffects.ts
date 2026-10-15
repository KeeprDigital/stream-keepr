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
 * approximated: the vocabulary is exactly what renders.
 */

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
 * The catalogue itself: one declaration per effect — its editor label and its
 * params schema — from which the vocabulary, every params type, and every host
 * union below are derived (#501). Outside this module an effect also needs its
 * renderer and lazy loader in `app/utils/animation-effects/` and its proof
 * scenario in `scripts/graphics-acceptance/animation-effect-scenarios.mjs`.
 *
 * Spatial params follow one standard, so an operator moving between effects
 * meets one meaning per name (ADR-0022, #503):
 * - `scale` sizes a repeating field's features (cells, facets, threads, fog,
 *   waves), so their count changes inversely. Label: "<Feature> scale".
 * - `size` sizes discrete elements whose count is fixed or set by another
 *   param (`density`, `points`). Label: "<Element> size".
 * - `spacing` sets the gap between elements without resizing them.
 *
 * A larger value always draws larger on screen, and a `scale` of 1 is the
 * effect's designed look. `zoom` and qualified variants (`cellSize`,
 * `waveScale`) are not used; the catalogue's unit test refuses them.
 */
export const ANIMATION_EFFECT_CATALOGUE = {
	/** Caustics: refracted-light interference drifting over a water colour. */
	caustics: {
		label: 'Caustics',
		paramsSchema: z.strictObject({
			lightColor: colorParam('Light color', '#7dd3fc'),
			waterColor: colorParam('Water color', '#083344'),
			intensity: numberParam('Intensity', { min: 0, max: 2, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
			scale: numberParam('Caustic scale', { min: 0.35, max: 2, step: 0.05, default: 1 }),
		}),
	},
	/**
	 * Cells: a Worley-noise cellular field, ported from the retired fork under its
	 * old name. Only the params the fragment shader reads survive the port: the
	 * fork's editor also offered `amplitudeFactor`, `ringFactor`, `rotationFactor`,
	 * and a background colour that its cells shader declared but never referenced.
	 * Defaults are the pre-rebuild application's, not the fork's, with the fork's
	 * `size` renormalised into `scale` so 1 is its old default of 3.
	 */
	cells: {
		label: 'Cells',
		paramsSchema: z.strictObject({
			color1: colorParam('Primary color', '#008c8c'),
			color2: colorParam('Secondary color', '#06b6d4'),
			scale: numberParam('Cell scale', { min: 0.1, max: 1.65, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 0.6 }),
		}),
	},
	/**
	 * Dots: a drifting field of point sprites with slowly tumbling radial line
	 * segments, ported from the retired fork under its old name. `backgroundColor`
	 * survives for the same reason as waves' — the fork's base cleared the canvas
	 * to it, and a dot field never covers the frame. `showLines` is the
	 * catalogue's first toggle param. Defaults and ranges are the pre-rebuild
	 * application's, including the dots-specific `spacing` fallback of 34 rather
	 * than the shared bag's 16.
	 */
	dots: {
		label: 'Dots',
		paramsSchema: z.strictObject({
			color: colorParam('Dot color', '#7c3aed'),
			color2: colorParam('Accent color', '#06b6d4'),
			backgroundColor: colorParam('Background color', '#111111'),
			size: numberParam('Dot size', { min: 0.5, max: 20, step: 0.5, default: 3 }),
			spacing: numberParam('Spacing', { min: 5, max: 100, step: 1, default: 34 }),
			showLines: toggleParam('Connecting lines', 'Render connecting line segments between dots.', true),
		}),
	},
	/**
	 * Ember: drifting embers rising through a dark frame — the first new effect
	 * after the ports, so the params carry semantic names (the caustics precedent)
	 * rather than a fork bag's. `density` thins or crowds the field without
	 * resizing any ember; `size` and `intensity` scale one ember's glow radius and
	 * brightness.
	 */
	ember: {
		label: 'Ember',
		paramsSchema: z.strictObject({
			emberColor: colorParam('Ember color', '#f97316'),
			coreColor: colorParam('Core color', '#fef3c7'),
			backgroundColor: colorParam('Background color', '#111111'),
			density: numberParam('Density', { min: 0.2, max: 3, step: 0.1, default: 1 }),
			size: numberParam('Ember size', { min: 0.2, max: 5, step: 0.1, default: 1 }),
			intensity: numberParam('Intensity', { min: 0, max: 2, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
		}),
	},
	/**
	 * Fog: the fbm domain-warp shader ported from the retired fork under its old
	 * name, minus the mouse uniform nothing on a headless browser source ever fed.
	 */
	fog: {
		label: 'Fog',
		paramsSchema: z.strictObject({
			highlightColor: colorParam('Highlight color', '#f59e0b'),
			midtoneColor: colorParam('Midtone color', '#7c3aed'),
			lowlightColor: colorParam('Lowlight color', '#06b6d4'),
			baseColor: colorParam('Base color', '#111111'),
			blurFactor: numberParam('Softness', { min: 0.1, max: 0.95, step: 0.05, default: 0.55 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 0.6 }),
			scale: numberParam('Fog scale', { min: 0.35, max: 2, step: 0.05, default: 1 }),
		}),
	},
	/**
	 * Globe: a wireframe sphere with radial accents and pole lines turning over a
	 * waving, line-strung point plane, ported from the retired fork under its old
	 * name. Every param is read. Net's vertex-colour restoration applies here too —
	 * the fork passed the removed `THREE.VertexColors` constant, so its connection
	 * lines rendered flat white on air; the port enables vertex colours. One label
	 * is corrected: the pre-rebuild editor called `size` "Point size", but the
	 * fork only ever read it as the wireframe globe's radius scale.
	 */
	globe: {
		label: 'Globe',
		paramsSchema: z.strictObject({
			color: colorParam('Primary color', '#7c3aed'),
			color2: colorParam('Secondary color', '#06b6d4'),
			backgroundColor: colorParam('Background color', '#111111'),
			size: numberParam('Globe size', { min: 0.2, max: 5, step: 0.1, default: 1 }),
			points: numberParam('Point count', { min: 2, max: 30, step: 1, default: 10 }),
			maxDistance: numberParam('Connection distance', { min: 1, max: 80, step: 1, default: 22 }),
			spacing: numberParam('Spacing', { min: 2, max: 80, step: 1, default: 16 }),
			showDots: toggleParam('Point markers', 'Render point markers around the globe.', true),
		}),
	},
	/**
	 * Halo: a flower-edged ring of cycling hues smearing through a feedback
	 * buffer, ported from the retired fork under its old name. Only the params the
	 * fragment shader reads survive the port: the fork's editor also offered
	 * `color2`, `ringFactor`, and `rotationFactor`, which its halo shader declared
	 * and never referenced. Defaults are the pre-rebuild application's.
	 */
	halo: {
		label: 'Halo',
		paramsSchema: z.strictObject({
			baseColor: colorParam('Base color', '#111111'),
			backgroundColor: colorParam('Background color', '#111111'),
			amplitudeFactor: numberParam('Intensity', { min: 0, max: 4, step: 0.1, default: 1 }),
			size: numberParam('Halo size', { min: 0.2, max: 5, step: 0.1, default: 1 }),
			xOffset: numberParam('Horizontal offset', { min: -1, max: 1, step: 0.05, default: 0 }),
			yOffset: numberParam('Vertical offset', { min: -1, max: 1, step: 0.05, default: 0 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
		}),
	},
	/**
	 * Inkmap: slow-morphing ink islands on dark paper, drawn like a living map —
	 * a domain-warped noise field thresholded into hard-edged pools with a
	 * luminous rim, ringed by faint topographic contour lines in the surrounding
	 * paper. A new effect (no fork ancestry), so the params carry semantic names
	 * and the defaults are the recorded design's (#473). `coverage` moves the ink
	 * threshold, `contours` counts the iso-lines outside the islands.
	 */
	inkmap: {
		label: 'Inkmap',
		paramsSchema: z.strictObject({
			inkColor: colorParam('Ink color', '#312e81'),
			edgeColor: colorParam('Edge color', '#06b6d4'),
			backgroundColor: colorParam('Background color', '#111111'),
			coverage: numberParam('Coverage', { min: 0.2, max: 0.8, step: 0.05, default: 0.5 }),
			contours: numberParam('Contour lines', { min: 0, max: 8, step: 1, default: 4 }),
			scale: numberParam('Island scale', { min: 0.35, max: 2, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
		}),
	},
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
	net: {
		label: 'Net',
		paramsSchema: z.strictObject({
			color: colorParam('Line color', '#7c3aed'),
			backgroundColor: colorParam('Background color', '#111111'),
			points: numberParam('Point count', { min: 2, max: 30, step: 1, default: 10 }),
			maxDistance: numberParam('Connection distance', { min: 1, max: 80, step: 1, default: 22 }),
			spacing: numberParam('Spacing', { min: 2, max: 80, step: 1, default: 16 }),
			showDots: toggleParam('Point markers', 'Render point markers at net intersections.', true),
		}),
	},
	/**
	 * Ridgelines: stacked mountain-ridge silhouettes receding into the frame, each
	 * a drifting 1D-noise profile with a glowing crest line — a joyplot horizon.
	 * A new effect (no fork ancestry), so the params carry semantic names and the
	 * defaults are the recorded design's (#473). `ridges` counts the silhouettes,
	 * `relief` scales every profile's amplitude, `glow` the crest-line halo.
	 */
	ridgelines: {
		label: 'Ridgelines',
		paramsSchema: z.strictObject({
			crestColor: colorParam('Crest color', '#06b6d4'),
			fillColor: colorParam('Ridge color', '#1e1b4b'),
			backgroundColor: colorParam('Background color', '#111111'),
			ridges: numberParam('Ridge count', { min: 3, max: 12, step: 1, default: 7 }),
			relief: numberParam('Relief', { min: 0.2, max: 2, step: 0.1, default: 1 }),
			glow: numberParam('Crest glow', { min: 0, max: 2, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
		}),
	},
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
	rings: {
		label: 'Rings',
		paramsSchema: z.strictObject({
			backgroundColor: colorParam('Background color', '#111111'),
		}),
	},
	/**
	 * Ripple: rings of orbiting lights accumulating over a background colour,
	 * ported from the retired fork under its old name and the pre-rebuild
	 * application's defaults.
	 */
	ripple: {
		label: 'Ripple',
		paramsSchema: z.strictObject({
			color1: colorParam('Primary color', '#008c8c'),
			color2: colorParam('Secondary color', '#06b6d4'),
			backgroundColor: colorParam('Background color', '#111111'),
			amplitudeFactor: numberParam('Intensity', { min: 0, max: 4, step: 0.1, default: 1 }),
			ringFactor: numberParam('Ripple scale', { min: 0, max: 12, step: 0.1, default: 1 }),
			rotationFactor: numberParam('Rotation', { min: 0, max: 4, step: 0.1, default: 1 }),
			centerX: numberParam('Center X', { min: -1, max: 1, step: 0.05, default: 0 }),
			centerY: numberParam('Center Y', { min: -1, max: 1, step: 0.05, default: 0 }),
			frequency: numberParam('Ripple frequency', { min: 0, max: 4, step: 0.1, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 0.6 }),
		}),
	},
	/**
	 * Shards: a pane of shattered glass — slowly shifting Voronoi facets, each
	 * tinted a hashed shade between the background and the shard colour, crack
	 * lines glowing along every facet boundary, and an occasional glint sweeping
	 * across facets whose hashed orientation catches it. A new effect (no fork
	 * ancestry), so the params carry semantic names and the defaults are the
	 * recorded design's (#473). `scale` sizes the facets, `intensity` the crack
	 * glow and the glint together.
	 */
	shards: {
		label: 'Shards',
		paramsSchema: z.strictObject({
			shardColor: colorParam('Shard color', '#312e81'),
			edgeColor: colorParam('Edge color', '#7dd3fc'),
			backgroundColor: colorParam('Background color', '#111111'),
			scale: numberParam('Shard scale', { min: 0.5, max: 3, step: 0.1, default: 1 }),
			intensity: numberParam('Intensity', { min: 0, max: 2, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
		}),
	},
	/**
	 * Waves: a lit, choppy water plane — the first mesh-backend port from the
	 * retired fork, under its old name. `backgroundColor` survives the port even
	 * though the mesh never reads it: the fork's base cleared the canvas to it,
	 * and the water plane leaves the frame's far corners uncovered at low scale, so
	 * it is visible on air. Defaults and ranges are the pre-rebuild application's,
	 * with its `zoom` renormalised into `scale` so 1 is the waves-specific zoom
	 * fallback of 0.85 rather than the shared bag's 1.
	 */
	waves: {
		label: 'Waves',
		paramsSchema: z.strictObject({
			color: colorParam('Wave color', '#7c3aed'),
			backgroundColor: colorParam('Background color', '#111111'),
			shininess: numberParam('Shine', { min: 0, max: 100, step: 1, default: 30 }),
			waveHeight: numberParam('Wave height', { min: 0, max: 50, step: 1, default: 20 }),
			waveSpeed: numberParam('Wave speed', { min: 0, max: 4, step: 0.1, default: 1 }),
			scale: numberParam('Wave scale', { min: 0.6, max: 3.5, step: 0.05, default: 1 }),
		}),
	},
	/**
	 * Weave: an interlaced fabric of undulating warp and weft threads crossing
	 * over and under in strict alternation, with a soft sheen sweeping the cloth.
	 * A new effect (no fork ancestry), so the params carry semantic names and the
	 * defaults are the recorded design's (#473). `scale` sizes the thread grid,
	 * `thickness` the band width within it, `sheen` the travelling highlight.
	 */
	weave: {
		label: 'Weave',
		paramsSchema: z.strictObject({
			warpColor: colorParam('Warp color', '#7c3aed'),
			weftColor: colorParam('Weft color', '#06b6d4'),
			backgroundColor: colorParam('Background color', '#111111'),
			scale: numberParam('Thread scale', { min: 0.35, max: 2, step: 0.05, default: 1 }),
			thickness: numberParam('Thread width', { min: 0.2, max: 0.9, step: 0.05, default: 0.6 }),
			sheen: numberParam('Sheen', { min: 0, max: 2, step: 0.05, default: 1 }),
			speed: numberParam('Speed', { min: 0, max: 4, step: 0.1, default: 1 }),
		}),
	},
} satisfies Record<string, { label: string; paramsSchema: z.ZodObject }>;

type AnimationEffectCatalogue = typeof ANIMATION_EFFECT_CATALOGUE;

export type AnimationEffectName = keyof AnimationEffectCatalogue;

/** The closed vocabulary, in catalogue order. */
export const ANIMATION_EFFECT_VALUES = Object.keys(ANIMATION_EFFECT_CATALOGUE) as readonly AnimationEffectName[];

/** One effect's fully-defaulted params, as its renderer receives them. */
export type AnimationEffectParams<Effect extends AnimationEffectName> = z.output<AnimationEffectCatalogue[Effect]['paramsSchema']>;

export function animationEffectDefaultParams<Effect extends AnimationEffectName>(
	effect: Effect,
): AnimationEffectParams<Effect> {
	return ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema.parse({}) as AnimationEffectParams<Effect>;
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
 * One effect's branch of a host union: the effect's name paired with that
 * effect's own params and nothing else, plus whatever fields the host adds
 * (spread first, so a host field can never displace `effect` or `params`).
 * Strict, so a bag from any other effect — or from the retired pre-rebuild flat
 * shape — is refused rather than half-read (the reset ADR-0014 accepts).
 */
function animationEffectHostBranch<Effect extends AnimationEffectName, Shape extends z.ZodRawShape>(
	effect: Effect,
	shape: Shape,
) {
	// Narrowed by annotation, which the compiler takes on trust: reading through
	// the generic index alone widens it to every effect's schema.
	const paramsSchema: AnimationEffectCatalogue[Effect]['paramsSchema'] = ANIMATION_EFFECT_CATALOGUE[effect].paramsSchema;
	return z.strictObject({
		...shape,
		effect: z.literal(effect),
		params: z.optional(paramsSchema),
	});
}

/** Every effect's branch as one union type — distributed, so each keeps its own params. */
type AnimationEffectHostBranches<Shape extends z.ZodRawShape> = {
	[Effect in AnimationEffectName]: ReturnType<typeof animationEffectHostBranch<Effect, Shape>>;
}[AnimationEffectName];

/**
 * Every selection branch extended with one host's own fields, in catalogue
 * order.
 *
 * A host composes the shared selection rather than restating it, and it does so
 * across every branch — so the branch list is built once here and each host
 * names only what it adds.
 *
 * Mapping the vocabulary widens each branch to "any effect, any params", so the
 * list is asserted back to the distributed `AnimationEffectHostBranches`: the
 * discriminated union's per-effect params are what every consumer reads. Both
 * sides map the same catalogue keys, so neither can miss an effect, and the
 * branch type is `animationEffectHostBranch`'s own return type, so strictness
 * and optionality cannot drift from what is built. What the compiler takes on
 * trust is the pairing of each effect with its own schema; "fills each
 * effect's params from that effect's own schema in every union" in
 * `test/unit/shared/animationEffects.test.ts` pins it at runtime.
 */
function animationEffectHostBranches<Shape extends z.ZodRawShape>(shape: Shape) {
	return ANIMATION_EFFECT_VALUES.map(effect => animationEffectHostBranch(effect, shape)) as [
		AnimationEffectHostBranches<Shape>,
		...AnimationEffectHostBranches<Shape>[],
	];
}

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
export const animationEffectSelectionSchema = z.discriminatedUnion('effect', animationEffectHostBranches({}));

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

/** What a renderer mount takes: the effect to draw, and the params to draw it with. */
export interface AnimationEffectRenderPlan {
	effect: AnimationEffectName;
	params?: AnimationEffectParams<AnimationEffectName>;
}

/**
 * A parsed selection as the shared mount takes it, whatever host it came from —
 * a Frame's animation, a Background Layer's, a Broadcast Graphics Background.
 *
 * It exists for the cast: the schema pairs each effect with its own params, and
 * the union loses that pairing at the point a single component has to accept any
 * of them. Restating it once here is what keeps three hosts from each carrying
 * their own copy of the same assertion.
 */
export function animationEffectRenderPlan(
	selection: z.output<typeof animationEffectSelectionSchema>,
): AnimationEffectRenderPlan {
	return {
		effect: selection.effect,
		params: selection.params as AnimationEffectParams<AnimationEffectName> | undefined,
	};
}

/**
 * What both of the hosts that wrap a selection currently add: whether the effect
 * shows at all, and at what opacity.
 *
 * Shared because they coincide, not because a host is required to want them: the
 * builder above is generic precisely so a host needing something else passes its
 * own shape, and a host that grows a field of its own stops sharing this one.
 */
const enabledAndOpacityShape = {
	enabled: z.boolean(),
	opacity: z.number().min(0).max(1),
};

/**
 * The Feature Match Overlay Frame's animation configuration: the shared effect
 * selection plus the Frame's own `enabled` and `opacity`.
 */
export const featureMatchOverlayFrameAnimationConfigSchema = z.discriminatedUnion(
	'effect',
	animationEffectHostBranches(enabledAndOpacityShape),
);

/**
 * A Broadcast Graphics Screen's background: the shared effect selection plus the
 * Screen's own `enabled` and `opacity`.
 *
 * The third Animation Effect host (#495), and the one that adds the least: the
 * canvas, the stack order, and playout are already the Screen's, so a background
 * is one selection, shown or not, at an opacity. Colour, gradient, image and
 * video backdrops are a Background Screen's ordered stack behind this Screen's
 * output, not a second copy of that stack here.
 */
export const broadcastGraphicsBackgroundConfigSchema = z.discriminatedUnion(
	'effect',
	animationEffectHostBranches(enabledAndOpacityShape),
);

/** The stored/authored shape: params sparse, defaults implied. */
export type BroadcastGraphicsBackgroundConfig = z.input<typeof broadcastGraphicsBackgroundConfigSchema>;

/**
 * A stored Broadcast Graphics background re-proven rather than trusted: the
 * parsed config, or `null` for one naming an effect this build does not ship —
 * the vocabulary refusal, applied at render time. Callers treat `null` as no
 * background (renderer) or start over from defaults (editor).
 */
export function parseBroadcastGraphicsBackgroundConfig(
	value: unknown,
): z.output<typeof broadcastGraphicsBackgroundConfigSchema> | null {
	const outcome = broadcastGraphicsBackgroundConfigSchema.safeParse(value);
	return outcome.success ? outcome.data : null;
}

/**
 * The stored/authored shape: params sparse, defaults implied. Renderers parse it
 * through the schema to get the fully-defaulted `AnimationEffectParams` form.
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
