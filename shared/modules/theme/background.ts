import type { GraphicAssetId, GraphicAssetRevisionId } from '../../types/graphicsAsset';
import type { BackgroundLayer } from '../../types/screenConfig';
import { z } from 'zod';
import { animationEffectSelectionSchema } from '../../animationEffects';
import { MEDIA_FIT_VALUES } from '../../types/graphicItem';
import { MAX_GRAPHIC_MEDIA_PLAYBACK_RATE, MIN_GRAPHIC_MEDIA_PLAYBACK_RATE } from '../../types/graphics';
import { remoteMediaUrlRefusal } from '../../utils/remoteMediaUrl';

/**
 * The one Background Layer stack schema: a Screen's own stack (ADR-0016) and
 * the Theme's `background` token hold the same layers, painted by the same
 * stack component, so both validate here. A library image or video layer is a
 * Graphic Asset Reference its owner indexes, whether that is a Screen or a
 * Theme (ADR-0050).
 */
export type ThemeBackgroundLayer = BackgroundLayer;

const opacitySchema = z.number().finite().min(0).max(1);

/** One exact Graphic Asset Revision, as a document names it. */
export const graphicAssetReferenceSchema = z.object({
	assetId: z.string().trim().min(1).max(100).transform(value => value as GraphicAssetId),
	revisionId: z.string().trim().min(1).max(100).transform(value => value as GraphicAssetRevisionId),
}).strict();

/**
 * `videoCompatibility` as documents recorded it before ADR-0020: accepted so a
 * stored stack, layout or exported Template Package that still carries it reads,
 * and dropped, because Chromium is now the only supported engine for transparent
 * video and the fact means nothing. Only the values it could hold are accepted, so
 * a document that never was valid still is not.
 */
export const retiredVideoCompatibilitySchema = z
	.enum(['all-supported', 'chromium-transparency'])
	.optional()
	.transform(() => undefined);

/**
 * A Remote Media URL: HTTPS, or root-relative under an app-served media prefix;
 * empty means unset (ADR-0021). The rule and its wording live in
 * `remoteMediaUrlRefusal`, which the editor shows before a save is attempted.
 */
const remoteMediaUrlSchema = z.string().max(2000).superRefine((value, context) => {
	const refusal = remoteMediaUrlRefusal(value);
	if (refusal !== undefined)
		context.addIssue({ code: 'custom', message: refusal });
});

/**
 * A Screen Media Source: an exact Graphics Asset Library revision or a Remote
 * Media URL, offered wherever a Screen supplies its own media — Background
 * Layers and the Feature Match Overlay Frame (ADR-0021). The asset branch is
 * shaped as a media Graphic Input value is.
 */
export const screenMediaSourceSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('asset'),
		...graphicAssetReferenceSchema.shape,
		videoCompatibility: retiredVideoCompatibilitySchema,
	}).strict(),
	z.object({
		kind: z.literal('url'),
		url: remoteMediaUrlSchema,
	}).strict(),
]);

/**
 * The bounds Screen-owned video (the Feature Match Overlay Frame's video and a
 * video Background Layer) was stored under before #539 narrowed it to a Media
 * Graphic Item's 0.25–4.
 */
const LEGACY_SCREEN_MEDIA_PLAYBACK_RATE = { min: 0.1, max: 16 } as const;

/**
 * A Screen-owned video's playback rate: a Media Graphic Item's 0.25–4, so every
 * media host shares one bound (#539).
 *
 * Stored mode configurations are read without a schema, but the editors re-send
 * a whole Background Layer stack or Frame layout on any edit. A rate the old
 * 0.1–16 bounds accepted is therefore clamped into range rather than refused:
 * refusing it would refuse every later edit to that stack or layout, however
 * unrelated. Anything outside the old bounds was never storable and is refused.
 */
export const screenMediaPlaybackRateSchema = z.preprocess(
	value => typeof value === 'number'
		&& value >= LEGACY_SCREEN_MEDIA_PLAYBACK_RATE.min
		&& value <= LEGACY_SCREEN_MEDIA_PLAYBACK_RATE.max
		? Math.min(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE, Math.max(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE, value))
		: value,
	z.number().finite().min(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE).max(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE),
);

/** What every Background Layer owns regardless of type — see `BackgroundLayerBase`. */
const layerShape = {
	id: z.string().min(1).max(100),
	enabled: z.boolean(),
	opacity: opacitySchema,
};

const layerSchema = z.discriminatedUnion('type', [
	z.object({
		...layerShape,
		type: z.literal('color'),
		color: z.string().min(1).max(500),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('gradient'),
		gradient: z.string().min(1).max(1000),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('image'),
		source: screenMediaSourceSchema,
		fit: z.enum(MEDIA_FIT_VALUES),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('video'),
		source: screenMediaSourceSchema,
		fit: z.enum(MEDIA_FIT_VALUES),
		playbackRate: screenMediaPlaybackRateSchema,
		loop: z.boolean(),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('animation'),
		animation: animationEffectSelectionSchema,
	}).strict(),
]);

/**
 * A guardrail, not a derived cap: a real show stacks a handful of layers, and
 * the 512 KiB mode-configuration budget is the binding constraint long before
 * twenty video elements are.
 */
const MAX_BACKGROUND_LAYERS = 20;

/**
 * One ordered Background Layer stack — the Background Screen's `layers`, every
 * declaring mode's own `backgroundLayers` and the Theme's `background` token
 * validate identically.
 *
 * Painter's order: first layer is the bottom of the stack. Both rules live on
 * this array rather than on a mode object, because a field-level rule survives
 * the PATCH-schema derivation and an object-level one cannot reach that path
 * (see `assertNoUnenforceableModeConfigRules`, #85).
 *
 * At most one animation layer per stack: each is its own WebGL context, an OBS
 * browser source is memory-tight, and only one mode renders at a time, so the
 * per-stack rule keeps the per-Screen invariant. Liftable if a show needs two.
 */
export const backgroundLayerStackSchema = z.array(layerSchema)
	.max(MAX_BACKGROUND_LAYERS)
	.refine(
		layers => layers.filter(layer => layer.type === 'animation').length <= 1,
		'A Background Layer stack carries at most one animation layer',
	);
