import type { ServerValidatedKeys } from '~~/shared/screenModeConfigs/contract';
import type { BackgroundLayersCapableMode } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BroadcastGraphicConfig, GraphicGroupChildConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchSourceItemConfig, ModeConfigsMap } from '~~/shared/types/screenConfig';
import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { SCREEN_MODE_VALUES, screens } from '~~/server/db/schema';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicTypographyFields, shapeGeometrySchema } from '~~/server/schemas/api/graphicValues';
import { animationEffectSelectionSchema, storedFrameAnimationConfigSchema } from '~~/shared/animationEffects';
import { FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION } from '~~/shared/featureMatchSourceItems';
import {
	backgroundLayerStackSchema,
	retiredVideoCompatibilitySchema,
	screenMediaPlaybackRateSchema,
	screenMediaSourceSchema,
} from '~~/shared/modules/theme/background';
import {
	GRAPHIC_FONT_IDS,
	graphicSourceRelationKind,
	graphicTextTemplateDottedPlaceholderKeys,
	graphicTextTemplateProjectedValueReferences,
	isKnownGraphicBindingFieldId,
	readSocialProfileProjectedValueReference,
} from '~~/shared/modules/graphics';
import { isServerValidatedField } from '~~/shared/screenModeConfigs/contract';
import { screenModeConfigContract, screenModeSupportsBackgroundLayers } from '~~/shared/screenModes';
import { SUPPORTED_SOCIAL_NETWORK_KEYS } from '~~/shared/socialProfiles';
import {
	FORMER_SCREEN_MODE_KEYS,
	HORIZONTAL_ALIGN_VALUES,
	PLAYER_SIDE_VALUES,
	SCREEN_COLOR_MODE_VALUES,
	SCREEN_COMMAND_VALUES,
	VERTICAL_ALIGN_VALUES,
} from '~~/shared/types/enums';
import {
	MEDIA_FIT_VALUES,
} from '~~/shared/types/graphicItem';
import {
	DECK_LIST_VIEW_VALUES,
	GAME_WINS_BOX_ORIENTATION_VALUES,
	GAME_WINS_DISPLAY_MODE_VALUES,
	GRAPHIC_ANCHOR_POINT_VALUES,
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
	GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES,
	GRAPHIC_GROUP_ALIGN_VALUES,
	GRAPHIC_GROUP_ARRANGEMENT_VALUES,
	GRAPHIC_GROUP_JUSTIFY_VALUES,
	GRAPHIC_INPUT_KEY_PATTERN,
	GRAPHIC_MEDIA_KIND_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	GRAPHIC_SLIDE_DISTANCE_MODE_VALUES,
	GRAPHIC_SOURCE_RELATION_VALUES,
	GRAPHIC_SOURCE_SELECTION_KIND_VALUES,
	GRAPHIC_TEXT_ALIGN_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_PAUSE_MS,
	MAX_GRAPHIC_ANIMATION_REPEAT,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
	MAX_GRAPHIC_FILL_STOPS,
	MAX_GRAPHIC_FONT_SIZE,
	MAX_GRAPHIC_INPUT_CHOICE_LENGTH,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MAX_GRAPHIC_SLIDE_DISTANCE_PX,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_TEXT_LENGTH,
	MAX_PIXEL_VALUE,
	MAX_PLAYER_LIFE_ANIMATION_DURATION_MS,
	MAX_SOCIAL_PROFILE_DWELL_MS,
	MAX_SOCIAL_PROFILE_PROJECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_SOCIAL_PROFILE_PROJECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_SOCIAL_PROFILE_TRANSITION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_REPEAT,
	MIN_GRAPHIC_FILL_STOPS,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MIN_PLAYER_LIFE_ANIMATION_DURATION_MS,
	MIN_SOCIAL_PROFILE_DWELL_MS,
	MIN_SOCIAL_PROFILE_TRANSITION_DURATION_MS,
	ON_AIR_UPDATE_POLICY_VALUES,
	PLAYER_LIFE_ANIMATION_VALUES,
	SOCIAL_PROFILE_TRANSITION_VALUES,
	TEXT_OVERFLOW_POLICY_VALUES,
} from '~~/shared/types/graphics';
import {
	FEATURE_MATCH_OVERLAY_ANCHOR_VALUES,
	FEATURE_MATCH_SOURCE_ROLE_VALUES,
	mergeScreenModeConfig,
} from '~~/shared/types/screenConfig';

const MAX_SCREEN_CONFIG_BYTES = 64 * 1024;
const MAX_MODE_CONFIGS_BYTES = 512 * 1024;

function jsonByteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/* ────────────────────────────────────────────────
 * Screen-level config schema (applies to all modes)
 * ──────────────────────────────────────────────── */

export const screenColorModeSchema = z.enum(SCREEN_COLOR_MODE_VALUES);
const horizontalAlignSchema = z.enum(HORIZONTAL_ALIGN_VALUES);
const verticalAlignSchema = z.enum(VERTICAL_ALIGN_VALUES);

export const screenConfigSchema = z.object({
	background: z.string().max(500).optional(),
	width: z.number().positive().optional(),
	height: z.number().positive().optional(),
	paddingX: z.number().nonnegative().optional(),
	paddingY: z.number().nonnegative().optional(),
	primaryTextColor: z.string().max(200).optional(),
	secondaryTextColor: z.string().max(200).optional(),
	colorMode: screenColorModeSchema.optional(),
	horizontalAlign: horizontalAlignSchema.optional(),
	verticalAlign: verticalAlignSchema.optional(),
}).strict();

const screenConfigPatchShape = Object.fromEntries(
	Object.entries(screenConfigSchema.shape).map(([key, schema]) => [
		key,
		schema.unwrap().nullable().optional(),
	]),
) as z.ZodRawShape;

export const screenSlugSchema = z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens');

// Patch variant: accepts `null` as a sentinel meaning "delete this key from stored config".
// Used by the PATCH endpoint to support clearing width/height back to auto.
export const screenConfigPatchSchema = z.object(screenConfigPatchShape).strict();

/* ────────────────────────────────────────────────
 * Mode config Zod schemas (strict — no unknown keys)
 * ──────────────────────────────────────────────── */

const finiteNumberSchema = z.number().finite();
const opacitySchema = finiteNumberSchema.min(0).max(1);
const pixelSizeSchema = finiteNumberSchema.positive().max(MAX_PIXEL_VALUE);
const pixelPositionSchema = finiteNumberSchema.min(-MAX_PIXEL_VALUE).max(MAX_PIXEL_VALUE);
const nonNegativePixelSchema = finiteNumberSchema.nonnegative().max(MAX_PIXEL_VALUE);
const cssColorSchema = z.string().min(1).max(500);
const optionalCssColorSchema = cssColorSchema.optional();
const graphicAssetReferenceSchema = z.object({
	assetId: z.string().min(1).max(100).transform(graphicAssetId),
	revisionId: z.string().min(1).max(100).transform(graphicAssetRevisionId),
}).strict();

/**
 * One media Graphic Input value on the wire: an exact revision, the same shape
 * wherever the choice is made — an authored default here, an operator's runtime
 * selection in the Broadcast Graphics Live Session.
 */
const mediaGraphicInputValueSchema = z.object({
	assetId: z.string().min(1).max(100).transform(graphicAssetId),
	revisionId: z.string().min(1).max(100).transform(graphicAssetRevisionId),
	videoCompatibility: retiredVideoCompatibilitySchema,
}).strict();

const screenMediaBackgroundConfigSchema = z.object({
	enabled: z.boolean(),
	source: screenMediaSourceSchema,
	fit: z.enum(MEDIA_FIT_VALUES),
	opacity: opacitySchema,
	playbackRate: screenMediaPlaybackRateSchema,
	loop: z.boolean(),
}).strict();

/** The field a mode's configuration gains by declaring a Background Layer stack. */
const BACKGROUND_LAYERS_CONFIG_SHAPE = {
	backgroundLayers: backgroundLayerStackSchema.optional(),
};

type ContractOf<M extends ScreenMode> = ReturnType<typeof screenModeConfigContract<M>>;

// `Extract` keeps the constraint visible: indexing the definitions by a generic
// mode loses that every contract's shape is a zod shape.
type ContractShape<M extends ScreenMode> = Extract<ContractOf<M>['shape'], z.ZodRawShape>;

/** The schema the server supplies for each server-validated field of a contract, typed to produce that field's type. */
type ServerFieldSchemas<Shape extends z.ZodRawShape> = {
	[K in ServerValidatedKeys<Shape>]: z.ZodType<z.output<Shape[K]>>;
};

/**
 * A mode's complete fields: the contract's, each server-validated one replaced
 * by the server's schema, plus `backgroundLayers` when the mode declares a stack.
 */
type ModeConfigShape<M extends ScreenMode> = Extract<{
	[K in keyof ContractShape<M>]: K extends ServerValidatedKeys<ContractShape<M>>
		? z.ZodType<z.output<ContractShape<M>[K]>>
		: ContractShape<M>[K];
} & (M extends BackgroundLayersCapableMode ? typeof BACKGROUND_LAYERS_CONFIG_SHAPE : unknown), z.ZodRawShape>;

/**
 * A PATCH body: every field optional and nullable, `null` being the "delete this
 * key" sentinel, except an authored stack, which a PATCH may replace but never
 * delete.
 */
type ModeConfigPatchShape<Shape, AuthoredStack extends PropertyKey> = Extract<{
	[K in keyof Shape]: K extends AuthoredStack
		? z.ZodOptional<Extract<Shape[K], z.ZodType>>
		: z.ZodOptional<z.ZodNullable<Extract<Shape[K], z.ZodType>>>;
}, z.ZodRawShape>;

/**
 * One mode's write forms, all derived from its config contract, so none restates
 * a field, a bound, or a default.
 *
 * - `schema` is the complete config: the contract's fields, with the server's
 *   schema for each server-validated one (`serverFields`, required exactly when
 *   the contract has such a field), plus `backgroundLayers` when the Screen Mode
 *   Definition declares a stack. That field is added here rather than on each
 *   contract, so a mode that declares a stack validates one, and a mode that does
 *   not refuses it, without either fact being restated.
 * - `stored` is what Screen create and full update accept for the mode: a
 *   fragment of `schema`, because that is what storage holds (`ModeConfigsMap`).
 *   PATCHes leave fragments, a display reset leaves every default but the
 *   preserved keys, and the Edit Screen dialog sends `modeConfigs` back as it read
 *   them, so requiring the complete config here would refuse a rename. Readers
 *   complete a fragment from the contract's defaults, so a full write never writes
 *   a default into storage.
 * - `patch` is every field `.nullable().optional()`, `null` being the "delete
 *   this key" sentinel, and each authored stack only `.optional()`, so `null`
 *   cannot empty it. No wrapper is peeled and no default stripped, because a
 *   contract's fields carry none.
 * - `stored` and `patch` both accept and drop the contract's former fields,
 *   which a client may still hold from a Screen it read before they were
 *   dropped (#752).
 *
 * `patch` deliberately carries no object-level check: a patch is a fragment, and
 * a whole-object rule cannot be evaluated against one. That once left
 * object-level rules silently unenforced on this path (#85). What closes it is
 * `parseModeConfigPatchResult`, which validates the configuration a patch would
 * produce against the whole-map rules, and `assertNoUnenforceableModeConfigRules`,
 * which refuses to boot on a per-mode object-level check, so every per-mode rule
 * lives on a field.
 */
function configContractModeForms<M extends ScreenMode>(
	mode: M,
	...[serverFields]: [ServerValidatedKeys<ContractShape<M>>] extends [never] ? [] : [ServerFieldSchemas<ContractShape<M>>]
) {
	const contract = screenModeConfigContract(mode);
	const supplied: Partial<Record<string, z.ZodType>> = serverFields ?? {};
	const own = Object.fromEntries(Object.entries(contract.shape as Record<string, z.ZodType>).map(([key, field]) => {
		if (!isServerValidatedField(field))
			return [key, field];
		const serverField = supplied[key];
		if (!serverField)
			throw new Error(`Screen Mode "${mode}" config field "${key}" is server-validated, but the server supplies no schema for it.`);
		return [key, serverField];
	}));
	const shape = (screenModeSupportsBackgroundLayers(mode)
		? {
				...own,
				...BACKGROUND_LAYERS_CONFIG_SHAPE,
			}
		: own) as ModeConfigShape<M>;
	const schema = z.object(shape).strict();

	const authoredStacks: readonly string[] = contract.authoredStacks;
	const patchShape = Object.fromEntries(Object.entries(shape as Record<string, z.ZodType>).map(([key, field]) => [
		key,
		authoredStacks.includes(key)
			? field.optional()
			: field.nullable().optional(),
	])) as ModeConfigPatchShape<ModeConfigShape<M>, ContractOf<M>['authoredStacks'][number]>;

	// A former field may still be in what a client read, so a write naming one
	// is accepted without storing it (#752); every other unknown key is refused.
	return {
		schema,
		stored: z.preprocess(contract.withoutFormerFields, schema.partial()),
		patch: z.preprocess(contract.withoutFormerFields, z.object(patchShape).strict()),
	};
}

const featureMatchOverlayAnchorValueSchema = z.enum(FEATURE_MATCH_OVERLAY_ANCHOR_VALUES);

const featureMatchOverlayRectSchema = z.object({
	x: pixelPositionSchema,
	y: pixelPositionSchema,
	width: pixelSizeSchema,
	height: pixelSizeSchema,
}).strict();

const featureMatchOverlayBorderSidesSchema = z.object({
	borderTopVisible: z.boolean().optional(),
	borderRightVisible: z.boolean().optional(),
	borderBottomVisible: z.boolean().optional(),
	borderLeftVisible: z.boolean().optional(),
}).strict();

/**
 * The surface treatment of a host-owned Source Item.
 *
 * Per-side border visibility and per-corner radii stay here because the Frame and
 * its Source Items are host capability the Host Contract leaves with the host.
 * The shared Graphic Surface Style dropped per-side borders in favour of composed
 * rule-preset Shape Graphic Items, and carries its own corner treatment in Shape
 * Geometry.
 */
const featureMatchSourceFramingStyleSchema = featureMatchOverlayBorderSidesSchema.extend({
	backgroundColor: optionalCssColorSchema,
	backgroundOpacity: opacitySchema.optional(),
	backgroundGradient: z.string().max(1000).optional(),
	borderVisible: z.boolean().optional(),
	borderColor: optionalCssColorSchema,
	borderWidth: nonNegativePixelSchema.optional(),
	borderRadius: nonNegativePixelSchema.optional(),
	borderRadiusTopLeft: nonNegativePixelSchema.optional(),
	borderRadiusTopRight: nonNegativePixelSchema.optional(),
	borderRadiusBottomRight: nonNegativePixelSchema.optional(),
	borderRadiusBottomLeft: nonNegativePixelSchema.optional(),
	glowColor: optionalCssColorSchema,
	glowSize: nonNegativePixelSchema.optional(),
	glowOpacity: opacitySchema.optional(),
	glowPosition: z.enum(['both', 'inside', 'outside']).optional(),
}).strict();

const featureMatchOverlayFrameConfigSchema = featureMatchOverlayBorderSidesSchema.extend({
	backgroundColor: cssColorSchema,
	opacity: opacitySchema,
	backgroundImage: screenMediaSourceSchema.optional(),
	backgroundImageFit: z.enum(MEDIA_FIT_VALUES).optional(),
	mediaBackground: screenMediaBackgroundConfigSchema.optional(),
	gradient: z.string().max(1000).optional(),
	// The stored-payload wrapper rather than the plain config schema: every
	// layout write re-sends the whole stored layout, so a pre-rebuild animation
	// bag resets to absent here instead of vetoing the edit it rides along on.
	animation: storedFrameAnimationConfigSchema.optional(),
	borderVisible: z.boolean().optional(),
	borderColor: optionalCssColorSchema,
	borderWidth: nonNegativePixelSchema.optional(),
	glowColor: optionalCssColorSchema,
	glowSize: nonNegativePixelSchema.optional(),
	glowOpacity: opacitySchema.optional(),
}).strict();

/**
 * A Source Item: the one Feature Match Overlay-specific Graphic Item Definition,
 * and the only Graphic Item a Feature Match Layout stores outside its shared
 * composition. Top-level only — a Graphic Group never contains one.
 */
const featureMatchSourceItemConfigSchema = featureMatchOverlayRectSchema.extend({
	id: z.string().min(1).max(100),
	label: z.string().min(1).max(100),
	visible: z.boolean(),
	anchor: featureMatchOverlayAnchorValueSchema.optional(),
	configurationVersion: z.literal(FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION).optional(),
	// A closed vocabulary, not free text: a role is the one thing a Source Item
	// declares that means anything on another installation.
	sourceRole: z.enum(FEATURE_MATCH_SOURCE_ROLE_VALUES).optional(),
	frameCutout: z.boolean(),
	framingStyle: featureMatchSourceFramingStyleSchema.optional(),
}).strict() satisfies z.ZodType<FeatureMatchSourceItemConfig>;

/* ────────────────────────────────────────────────
 * Shared Graphics Foundation vocabulary
 * ──────────────────────────────────────────────── */

const graphicAnchorPointSchema = z.enum(GRAPHIC_ANCHOR_POINT_VALUES);
const graphicRotationSchema = finiteNumberSchema.min(-360).max(360);

/**
 * A Graphic Font Selection: an application font that ships with Stream Keepr, or
 * one exact font Graphic Asset Revision. Strict on both arms, so a document
 * carrying an application id *and* a reference is refused rather than resolved by
 * whichever branch happens to match first.
 */
const graphicFontSelectionSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('application'),
		fontId: z.enum(GRAPHIC_FONT_IDS),
	}).strict(),
	z.object({
		kind: z.literal('asset'),
		reference: graphicAssetReferenceSchema,
	}).strict(),
]);

const graphicTypographySchema = z.object({
	font: graphicFontSelectionSchema,
	...graphicTypographyFields,
	textAlign: z.enum(GRAPHIC_TEXT_ALIGN_VALUES),
	color: cssColorSchema,
}).strict();

const graphicFillStopSchema = z.object({
	color: cssColorSchema,
	position: opacitySchema,
	opacity: opacitySchema,
}).strict();

const graphicFillSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('solid'),
		color: cssColorSchema,
	}).strict(),
	z.object({
		type: z.literal('linear-gradient'),
		angle: finiteNumberSchema.min(-360).max(360),
		stops: z.array(graphicFillStopSchema)
			.min(MIN_GRAPHIC_FILL_STOPS)
			.max(MAX_GRAPHIC_FILL_STOPS),
	}).strict(),
]);

const graphicSurfaceStyleSchema = z.object({
	fill: graphicFillSchema,
	fillOpacity: opacitySchema,
	outline: z.object({
		color: cssColorSchema,
		width: nonNegativePixelSchema.max(500),
	}).strict().optional(),
	glow: z.object({
		color: cssColorSchema,
		size: nonNegativePixelSchema.max(500),
		opacity: opacitySchema,
	}).strict().optional(),
}).strict();

/* Graphic Animation: bounded recipes rather than a keyframe timeline. */

const graphicAnimationChannelsShape = {
	fade: z.object({ opacity: opacitySchema }).strict().optional(),
	slide: z.object({
		direction: z.enum(GRAPHIC_SLIDE_DIRECTION_VALUES),
		distanceMode: z.enum(GRAPHIC_SLIDE_DISTANCE_MODE_VALUES),
		// Ignored while the mode clears the owner's parent, exactly as a square
		// Shape Geometry corner ignores its size.
		distance: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_SLIDE_DISTANCE_PX),
	}).strict().optional(),
	scale: z.object({
		factor: finiteNumberSchema.min(0).max(MAX_GRAPHIC_ANIMATION_SCALE),
		origin: z.enum(GRAPHIC_ANIMATION_ORIGIN_VALUES),
	}).strict().optional(),
	reveal: z.object({
		edge: z.enum(GRAPHIC_REVEAL_EDGE_VALUES),
	}).strict().optional(),
};

const graphicAnimationRecipeShape = {
	duration: finiteNumberSchema
		.min(MIN_GRAPHIC_ANIMATION_DURATION_MS)
		.max(MAX_GRAPHIC_ANIMATION_DURATION_MS),
	easing: z.enum(GRAPHIC_ANIMATION_EASING_VALUES),
	delay: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_ANIMATION_DELAY_MS),
	...graphicAnimationChannelsShape,
};

const graphicAnimationRecipeSchema = z.object(graphicAnimationRecipeShape).strict();

const graphicOnScreenAnimationRecipeSchema = z.object({
	...graphicAnimationRecipeShape,
	pause: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_ANIMATION_PAUSE_MS),
	repeat: z.union([
		finiteNumberSchema.int().min(MIN_GRAPHIC_ANIMATION_REPEAT).max(MAX_GRAPHIC_ANIMATION_REPEAT),
		z.literal(GRAPHIC_ANIMATION_REPEAT_INDEFINITE),
	]),
}).strict();

/**
 * The bound on a Graphic Item's identity, and on every id that names one.
 *
 * Every id this application writes is a 36-character uuid: the compositor mints
 * one per item, and every path that copies a document — placing a Broadcast
 * Graphic Template, installing a Template Package — mints fresh ones rather than
 * carrying the source's. 64 leaves that comfortable headroom and nothing else.
 *
 * It was 100, which nothing wrote and which the worst case paid for on every item
 * and, four times per container, on every id a Graphic Animation Stagger names.
 * That is most of what a stagger costs (#99).
 *
 * It is an import constraint as much as a write one, and deliberately the same
 * one: a Template Package's document is proved against these schemas, so a
 * document that installs is a document the Screen write path accepts.
 */
export const MAX_GRAPHIC_ITEM_ID_LENGTH = 64;

/**
 * A stagger names a subset of one container's direct Graphic Items, so it can
 * never name more ids than one Broadcast Graphic may hold Graphic Items. The cap
 * is stated here rather than reused from `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC`
 * because these schemas are built before that constant is initialised.
 *
 * The tighter bound — no more ids than the container itself holds items — is a
 * property of the container rather than of this list, so it lives on each
 * container below (`graphicStaggerNamesASubset`). This one remains as the field's
 * own ceiling.
 *
 * Ids are still not checked against the container's actual children: a stale id is
 * ignored at projection time instead, so a document that names a since-deleted item
 * is read rather than refused. Only the *count* is bounded.
 */
const MAX_GRAPHIC_ANIMATION_STAGGER_ITEMS = 100;

const graphicAnimationStaggerSchema = z.object({
	order: z.enum(GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES),
	step: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS),
	itemIds: z.array(z.string().min(1).max(MAX_GRAPHIC_ITEM_ID_LENGTH)).max(MAX_GRAPHIC_ANIMATION_STAGGER_ITEMS),
}).strict();

/**
 * At most one recipe per lifecycle phase, stated structurally: the phases are the
 * keys of one object, so a second enter recipe has nowhere to go.
 */
const graphicAnimationShape = {
	'enter': graphicAnimationRecipeSchema.optional(),
	'on-screen': graphicOnScreenAnimationRecipeSchema.optional(),
	'update': graphicAnimationRecipeSchema.optional(),
	'exit': graphicAnimationRecipeSchema.optional(),
};

const graphicAnimationSchema = z.object(graphicAnimationShape).strict();

/**
 * A stagger orders the container's own items, so it cannot name more of them than
 * the container has.
 *
 * Stated as a rule about the container because only the container knows its item
 * count; the field's own `.max()` cannot see it. That gap was worth closing on its
 * own terms — a list of 100 ids on a graphic holding one item orders nothing — and
 * it is also the single largest contributor to what the caps admit in bytes: four
 * phases of 100 ids each is about 26 KiB per container at the current id length,
 * on every one of the 50 Broadcast Graphic shells a Screen may hold, and no Graphic
 * Item cap can reach any of it. See #99.
 *
 * Stale ids stay legal: the count is bounded, membership is not, so a stagger that
 * names a since-deleted item is still read rather than refused.
 *
 * What makes the count safe to bound is that deleting a Graphic Item already
 * removes it from its container's staggered subsets — `deleteGraphicItem` in
 * `shared/modules/graphics/authoring.ts` does it, and copying a document into a
 * Broadcast Graphic Template does the same — so no authoring operation can leave a
 * container naming more items than it holds. A document that does was built by
 * hand, and refusing it is the correct answer rather than a regression of the
 * deletion tolerance.
 */
const GRAPHIC_STAGGER_SUBSET_MESSAGE
	= 'A Graphic Animation Stagger must not name more Graphic Items than its container holds';

function graphicStaggerNamesASubset(
	container: { animation?: { stagger?: Record<string, { itemIds: readonly string[] } | undefined> } },
	itemCount: number,
): boolean {
	const stagger = container.animation?.stagger;
	if (!stagger)
		return true;
	return Object.values(stagger).every(phase => (phase?.itemIds.length ?? 0) <= itemCount);
}

/** Only a container — a Broadcast Graphic or a Graphic Group — staggers direct items. */
const graphicContainerAnimationSchema = z.object({
	...graphicAnimationShape,
	stagger: z.object({
		'enter': graphicAnimationStaggerSchema.optional(),
		'on-screen': graphicAnimationStaggerSchema.optional(),
		'update': graphicAnimationStaggerSchema.optional(),
		'exit': graphicAnimationStaggerSchema.optional(),
	}).strict().optional(),
}).strict();

/* ────────────────────────────────────────────────
 * Graphic Inputs
 * ──────────────────────────────────────────────── */

/**
 * How many Graphic Placeholder Styles one Text Graphic Item may define.
 *
 * A placeholder style is a full typography override, so it is the most expensive
 * thing a Text Graphic Item can grow. Four is enough for the designs the fidelity
 * prototype needs — a name, a surname, a score, a suffix — and keeps a maximal
 * Text Graphic Item within the whole-Screen byte budget below.
 */
export const MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM = 4;

export const MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC = 24;

/**
 * The whole-Screen Graphic Input, Graphic Input Binding, and Graphic Source
 * Selection budgets, for the same reason the Graphic Item one exists: the
 * per-graphic caps and the per-Screen Broadcast Graphic cap bound each list
 * independently, and their product does not fit the mode-configuration byte limit.
 * A choice Graphic Input with a full option list is the expensive case, at about
 * 1,274 bytes against a Graphic Item's 2,682.
 */
export const MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN = 60;

/**
 * The two Graphic Source Selection budgets are declared in `shared/types/graphics`
 * and re-exported here, so this file still reads as the whole set of the wire's
 * bounds. They moved because an authoring surface has to stop before producing a
 * config this schema would refuse, and a client bundle cannot import this module.
 * The byte-budget reasoning above is what chose all of these numbers, including those
 * two.
 */
export {
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
};
export { MAX_GRAPHIC_CHANNELS_PER_SCREEN } from '~~/shared/screenModeConfigs/broadcastGraphics';

const graphicInputKeySchema = z.string()
	.min(1)
	.max(MAX_GRAPHIC_INPUT_KEY_LENGTH)
	.regex(GRAPHIC_INPUT_KEY_PATTERN, 'A Graphic Input key must start with a letter and contain only letters, digits, underscores, and hyphens');

const graphicInputLabelSchema = z.string().min(1).max(MAX_GRAPHIC_INPUT_LABEL_LENGTH);

const graphicInputDeclarationBaseShape = {
	key: graphicInputKeySchema,
	label: graphicInputLabelSchema,
	required: z.boolean(),
	updatePolicy: z.enum(ON_AIR_UPDATE_POLICY_VALUES),
};

const graphicInputDeclarationSchema = z.discriminatedUnion('type', [
	z.object({
		...graphicInputDeclarationBaseShape,
		type: z.literal('text'),
		default: z.string().max(MAX_GRAPHIC_TEXT_LENGTH),
		// A declared bound never exceeds the bound on a Text Graphic Item's own
		// stored template: a value no template could hold is not a useful value.
		maxLength: z.number().int().min(1).max(MAX_GRAPHIC_TEXT_LENGTH),
	}).strict(),
	z.object({
		...graphicInputDeclarationBaseShape,
		type: z.literal('number'),
		default: finiteNumberSchema.nullable(),
		min: finiteNumberSchema.optional(),
		max: finiteNumberSchema.optional(),
		integer: z.boolean(),
	}).strict(),
	z.object({
		...graphicInputDeclarationBaseShape,
		type: z.literal('toggle'),
		default: z.boolean(),
	}).strict(),
	z.object({
		...graphicInputDeclarationBaseShape,
		type: z.literal('choice'),
		default: z.string().max(MAX_GRAPHIC_INPUT_CHOICE_LENGTH).nullable(),
		options: z.array(z.object({
			value: z.string().min(1).max(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
			label: z.string().min(1).max(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
		}).strict()).max(MAX_GRAPHIC_INPUT_CHOICE_OPTIONS),
	}).strict(),
	z.object({
		...graphicInputDeclarationBaseShape,
		type: z.literal('color'),
		default: cssColorSchema.nullable(),
	}).strict(),
	z.object({
		...graphicInputDeclarationBaseShape,
		type: z.literal('media'),
		// A media Graphic Input's default is a pinned Graphics Asset Library
		// revision, exactly as an authored asset reference is.
		default: mediaGraphicInputValueSchema.nullable(),
		mediaKind: z.enum(GRAPHIC_MEDIA_KIND_VALUES),
	}).strict(),
]);

const graphicSourceSelectionSchema = z.object({
	key: graphicInputKeySchema,
	label: graphicInputLabelSchema,
	kind: z.enum(GRAPHIC_SOURCE_SELECTION_KIND_VALUES),
	/**
	 * A fixed relationship from another Graphic Source Selection instead of an
	 * operator pick. Whether the named selection exists and whether the relationship
	 * can yield this kind are checked on the `sources` array, which is the only place
	 * that can see its siblings.
	 */
	from: z.object({
		sourceKey: graphicInputKeySchema,
		relation: z.enum(GRAPHIC_SOURCE_RELATION_VALUES),
	}).strict().optional(),
}).strict();

/**
 * A Graphic Input Binding names one catalog field.
 *
 * Only that the field id is a catalog name **somewhere** is checked here, across all
 * eight Graphic Source Selection kinds at once. So `player.name` on a
 * `feature-match-slot` selection passes this check and then resolves nothing for as
 * long as it exists — authorable but permanently dead.
 *
 * That gap is deliberate rather than overlooked. Narrowing the id to the kind of the
 * selection it reads, or checking it against the type of the Graphic Input it feeds,
 * needs the `bindings`, `sources`, and `inputs` arrays together — an object-level
 * rule, and object-level rules do not survive the per-mode patch derivation the
 * editors write through, so it would be enforced on one write path and silently
 * dropped on the other. Resolution is total instead: a binding whose field does not
 * fit its kind or type resolves nothing, so the invariant that matters on air holds
 * where it is enforceable. An authoring surface that only ever offers
 * `graphicBindingFields(kind, game)` cannot produce the dead combination in the first
 * place; a hand-written API call can.
 */
const graphicInputBindingSchema = z.object({
	inputKey: graphicInputKeySchema,
	sourceKey: graphicInputKeySchema,
	fieldId: z.string().min(1).max(100).refine(
		isKnownGraphicBindingFieldId,
		'A Graphic Input Binding must name a field from the binding catalog',
	),
}).strict();

/**
 * One Social Profile Projection declaration. Referential integrity belongs to
 * the containing Broadcast Graphic, which can see the source and item lists.
 */
const socialProfileProjectionSchema = z.object({
	key: graphicInputKeySchema,
	label: graphicInputLabelSchema,
	sourceKey: graphicInputKeySchema,
	presentationGroupId: z.string().min(1).max(MAX_GRAPHIC_ITEM_ID_LENGTH),
	// Optional on the wire so documents authored before projection re-resolution keep
	// their established staged behaviour rather than becoming strict-save-invalid.
	updatePolicy: z.enum(ON_AIR_UPDATE_POLICY_VALUES).optional(),
	dwellMs: finiteNumberSchema.int()
		.min(MIN_SOCIAL_PROFILE_DWELL_MS)
		.max(MAX_SOCIAL_PROFILE_DWELL_MS),
	transition: z.enum(SOCIAL_PROFILE_TRANSITION_VALUES),
	transitionDurationMs: finiteNumberSchema.int()
		.min(MIN_SOCIAL_PROFILE_TRANSITION_DURATION_MS)
		.max(MAX_SOCIAL_PROFILE_TRANSITION_DURATION_MS),
}).strict();

/** Whether every derived Graphic Source Selection names a sibling it can actually follow. */
function graphicSourceDerivationsResolve(
	sources: readonly { key: string; kind: string; from?: { sourceKey: string; relation: string } }[],
): boolean {
	const byKey = new Map(sources.map(source => [source.key, source]));

	return sources.every((source) => {
		if (!source.from)
			return true;
		const parent = byKey.get(source.from.sourceKey);
		if (!parent || parent.key === source.key)
			return false;
		return graphicSourceRelationKind(
			parent.kind as never,
			source.from.relation as never,
		) === source.kind;
	});
}

/**
 * Whether the `from` chains terminate rather than looping back on themselves.
 *
 * Unreachable while the relation vocabulary stays acyclic, since a loop fails the
 * reachability check above first. Kept as the rule an author would want stated if a
 * future relation closes a cycle.
 */
function graphicSourceDerivationsAcyclic(
	sources: readonly { key: string; from?: { sourceKey: string } }[],
): boolean {
	const byKey = new Map(sources.map(source => [source.key, source]));

	return sources.every((source) => {
		const seen = new Set<string>([source.key]);
		let current = source.from?.sourceKey;
		while (current !== undefined) {
			if (seen.has(current))
				return false;
			seen.add(current);
			current = byKey.get(current)?.from?.sourceKey;
		}
		return true;
	});
}

/* ────────────────────────────────────────────────
 * Graphic Style Set references
 * ──────────────────────────────────────────────── */

/**
 * The bound on a Graphic Style Set identity, and on one entry's identity within it.
 *
 * One schema because they are the same kind of opaque stable id, generated the same
 * way and stored the same way. They are named separately so a reader of the two
 * fields below does not have to work out that a `styleSetId` is not an entry id.
 */
const graphicStyleIdSchema = z.string().min(1).max(100);
const graphicStyleEntryIdSchema = graphicStyleIdSchema;
const graphicStyleSetIdSchema = graphicStyleIdSchema;

/**
 * A media treatment's owned properties, as one object so its override shape is a
 * partial of exactly the same thing the Media Graphic Item stores.
 */
const graphicMediaTreatmentPropertiesSchema = z.object({
	fit: z.enum(MEDIA_FIT_VALUES),
	focalPosition: z.object({ horizontal: opacitySchema, vertical: opacitySchema }).strict(),
	opacity: opacitySchema,
	clipGeometry: shapeGeometrySchema.optional(),
	playbackRate: finiteNumberSchema
		.min(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE)
		.max(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE),
	loop: z.boolean(),
}).strict();

/**
 * One slot's reference to a Graphic Style Set entry.
 *
 * Every override shape is derived from the property schema it deviates from, rather
 * than restated: an override is a *partial of the same property group*, so a bound
 * that tightens on typography tightens on a typography override in the same commit.
 * A slot whose value has no meaningful partial — a Graphic Fill, which is a
 * discriminated union — takes no overrides at all.
 *
 * The reference carries no value. A graphics document always stores its own resolved
 * properties inline, so nothing here is needed to render it; this is the provenance
 * that makes a republished Style Set a reviewable offer instead of a silent change.
 */
function graphicStyleRefSchema<T extends z.ZodType>(overrides: T) {
	return z.object({
		entryId: graphicStyleEntryIdSchema,
		overrides: overrides.optional(),
	}).strict();
}

/** The one slot with no meaningful partial to override. */
const graphicFillStyleRefSchema = z.object({ entryId: graphicStyleEntryIdSchema }).strict();

const graphicAnimationRecipeOverridesSchema = z.object(graphicAnimationRecipeShape).strict().partial();

const graphicAnimationStyleRefShape = {
	'animation.enter': graphicStyleRefSchema(graphicAnimationRecipeOverridesSchema).optional(),
	'animation.on-screen': graphicStyleRefSchema(graphicOnScreenAnimationRecipeSchema.partial()).optional(),
	'animation.update': graphicStyleRefSchema(graphicAnimationRecipeOverridesSchema).optional(),
	'animation.exit': graphicStyleRefSchema(graphicAnimationRecipeOverridesSchema).optional(),
};

const graphicItemStyleRefsSchema = z.object({
	'typography': graphicStyleRefSchema(graphicTypographySchema.omit({ textAlign: true }).partial()).optional(),
	'surfaceStyle': graphicStyleRefSchema(graphicSurfaceStyleSchema.partial()).optional(),
	'surfaceStyle.fill': graphicFillStyleRefSchema.optional(),
	'defaultChildSurfaceStyle': graphicStyleRefSchema(graphicSurfaceStyleSchema.partial()).optional(),
	'boxSurfaceStyle': graphicStyleRefSchema(graphicSurfaceStyleSchema.partial()).optional(),
	'wonBoxSurfaceStyle': graphicStyleRefSchema(graphicSurfaceStyleSchema.partial()).optional(),
	'geometry': graphicStyleRefSchema(shapeGeometrySchema.partial()).optional(),
	'clipGeometry': graphicStyleRefSchema(shapeGeometrySchema.partial()).optional(),
	'boxGeometry': graphicStyleRefSchema(shapeGeometrySchema.partial()).optional(),
	'media': graphicStyleRefSchema(graphicMediaTreatmentPropertiesSchema.partial()).optional(),
	...graphicAnimationStyleRefShape,
}).strict();

/**
 * A Broadcast Graphic's own references: whole-composition motion and nothing else.
 * It has no typography, surface, geometry, or media to inherit into, so the wire
 * refuses those slots rather than storing references nothing can apply.
 */
const graphicContainerStyleRefsSchema = z.object(graphicAnimationStyleRefShape).strict();

/** At most one Graphic Style Set per composition, stated by this being one object. */
const graphicStyleSetLinkSchema = z.object({
	styleSetId: graphicStyleSetIdSchema,
	// The only field the worst-case measurement cannot populate at a maximum,
	// because it has none: a revision counts publications and nothing bounds how
	// many a Style Set may have. Its contribution to the byte budget is therefore
	// the width of a number rather than a cap, which is why it is left unbounded
	// rather than given an arbitrary ceiling — but it is worth knowing it is the
	// one hole in `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES`.
	revision: z.number().int().nonnegative(),
}).strict();

const graphicItemBaseShape = {
	id: z.string().min(1).max(MAX_GRAPHIC_ITEM_ID_LENGTH),
	label: z.string().min(1).max(100),
	visible: z.boolean(),
	anchor: graphicAnchorPointSchema,
	rotation: graphicRotationSchema.optional(),
	x: pixelPositionSchema,
	y: pixelPositionSchema,
	width: pixelSizeSchema,
	height: pixelSizeSchema,
	animation: graphicAnimationSchema.optional(),
	styleRefs: graphicItemStyleRefsSchema.optional(),
};

/**
 * A Graphic Placeholder Style is a typography-only override for one `{inputKey}`,
 * so every property is optional and only the ones an author changed are stored.
 * Line height and text alignment are absent: they lay out the whole text block
 * rather than one run inside it.
 */
const graphicPlaceholderStyleSchema = z.object({
	font: graphicFontSelectionSchema.optional(),
	fontSize: graphicTypographyFields.fontSize.optional(),
	fontWeight: graphicTypographyFields.fontWeight.optional(),
	fontStyle: graphicTypographyFields.fontStyle.optional(),
	textTransform: graphicTypographyFields.textTransform.optional(),
	letterSpacing: graphicTypographyFields.letterSpacing.optional(),
	color: cssColorSchema.optional(),
}).strict();

const graphicPlaceholderKeySchema = z.string().refine(
	key => GRAPHIC_INPUT_KEY_PATTERN.test(key)
		|| readSocialProfileProjectedValueReference(key) !== undefined,
	'A Graphic Placeholder Style must name a Graphic Input or projected text value',
);

const textGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('text'),
	text: z.string().max(MAX_GRAPHIC_TEXT_LENGTH),
	typography: graphicTypographySchema,
	overflowPolicy: z.enum(TEXT_OVERFLOW_POLICY_VALUES),
	minFontSize: finiteNumberSchema.positive().max(MAX_GRAPHIC_FONT_SIZE),
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
	placeholderStyles: z.record(
		graphicPlaceholderKeySchema,
		graphicPlaceholderStyleSchema,
	).refine(
		styles => Object.keys(styles).length <= MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM,
		`A Text Graphic Item must not define more than ${MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM} Graphic Placeholder Styles`,
	).optional(),
};

const shapeGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('shape'),
	geometry: shapeGeometrySchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

/**
 * A Media Graphic Item.
 *
 * `asset` is optional because an author places the rectangle before choosing its
 * content, and `clipGeometry` because clipping is optional — absent, the item
 * clips to its own bounds. `videoCompatibility` is a retired key, accepted and
 * dropped so documents recorded before ADR-0020 still read.
 */
const mediaGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('media'),
	asset: graphicAssetReferenceSchema.optional(),
	mediaKind: z.enum(GRAPHIC_MEDIA_KIND_VALUES),
	fit: z.enum(MEDIA_FIT_VALUES),
	focalPosition: z.object({
		horizontal: opacitySchema,
		vertical: opacitySchema,
	}).strict(),
	opacity: opacitySchema,
	clipGeometry: shapeGeometrySchema.optional(),
	videoCompatibility: retiredVideoCompatibilitySchema,
	playbackRate: finiteNumberSchema
		.min(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE)
		.max(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE),
	loop: z.boolean(),
};

const socialNetworkIconGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('social-network-icon'),
	network: z.union([
		z.enum(SUPPORTED_SOCIAL_NETWORK_KEYS),
		z.object({ projectionKey: graphicInputKeySchema }).strict(),
	]),
	color: cssColorSchema,
	opacity: opacitySchema,
};

/**
 * The context-gated Graphic Items.
 *
 * They are ordinary members of this union rather than a separate Feature Match
 * one: the compositor renders them, so the wire shape the compositor accepts is
 * the wire shape they have. Which host may carry one is decided by the Host
 * Contract's declared contexts at authoring time, not here — a schema that
 * rejected them for Broadcast Graphics would be restating a rule the definition
 * palette already enforces, in a place that cannot see the contract.
 *
 * A Clock and a Player Life carry a Text Graphic Item's typography and Text
 * Overflow Policy without its template, because their string comes from the live
 * Feature Match Session rather than from an author.
 */
const clockGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('clock'),
	typography: graphicTypographySchema,
	overflowPolicy: z.enum(TEXT_OVERFLOW_POLICY_VALUES),
	minFontSize: finiteNumberSchema.positive().max(MAX_GRAPHIC_FONT_SIZE),
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

const playerLifeGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('player-life'),
	playerSide: z.enum(PLAYER_SIDE_VALUES),
	typography: graphicTypographySchema,
	overflowPolicy: z.enum(TEXT_OVERFLOW_POLICY_VALUES),
	minFontSize: finiteNumberSchema.positive().max(MAX_GRAPHIC_FONT_SIZE),
	lifeAnimation: z.enum(PLAYER_LIFE_ANIMATION_VALUES),
	lifeAnimationDurationMs: finiteNumberSchema
		.int()
		.min(MIN_PLAYER_LIFE_ANIMATION_DURATION_MS)
		.max(MAX_PLAYER_LIFE_ANIMATION_DURATION_MS),
	lifeAnimationAccentColor: cssColorSchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

/**
 * A Game Wins Graphic Item. Its boxes are painted surfaces, so they carry a
 * canonical Shape Geometry and two Graphic Surface Styles rather than the legacy
 * widget's own border width and corner radius. The box count is absent by design:
 * it comes from the Match's best-of rather than from configuration.
 */
const gameWinsGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('game-wins'),
	playerSide: z.enum(PLAYER_SIDE_VALUES),
	displayMode: z.enum(GAME_WINS_DISPLAY_MODE_VALUES),
	boxOrientation: z.enum(GAME_WINS_BOX_ORIENTATION_VALUES),
	boxWidth: pixelSizeSchema,
	boxHeight: pixelSizeSchema,
	boxGap: nonNegativePixelSchema,
	boxGeometry: shapeGeometrySchema,
	boxSurfaceStyle: graphicSurfaceStyleSchema,
	wonBoxSurfaceStyle: graphicSurfaceStyleSchema,
	typography: graphicTypographySchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

/**
 * A Deck List Graphic Item. Sideboard-only at v1, so there is deliberately no
 * board field — widening later is an additive field and a configuration version
 * bump on the same kind. It renders cards and nothing else, so it carries no
 * Graphic Surface Style, and its overflow is a fixed shrink-then-clip rather
 * than an authored Text Overflow Policy.
 */
const deckListGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('deck-list'),
	playerSide: z.enum(PLAYER_SIDE_VALUES),
	view: z.enum(DECK_LIST_VIEW_VALUES),
	showQuantities: z.boolean(),
	typography: graphicTypographySchema,
};

const textGraphicItemConfigSchema = z.object(textGraphicItemShape).strict();
const shapeGraphicItemConfigSchema = z.object(shapeGraphicItemShape).strict();
const mediaGraphicItemConfigSchema = z.object(mediaGraphicItemShape).strict();
const socialNetworkIconGraphicItemConfigSchema = z.object(socialNetworkIconGraphicItemShape).strict();
const clockGraphicItemConfigSchema = z.object(clockGraphicItemShape).strict();
const playerLifeGraphicItemConfigSchema = z.object(playerLifeGraphicItemShape).strict();
const gameWinsGraphicItemConfigSchema = z.object(gameWinsGraphicItemShape).strict();
const deckListGraphicItemConfigSchema = z.object(deckListGraphicItemShape).strict();

/**
 * Main-axis sizing belongs to a Graphic Group child, so only a child carries
 * one: a top-level Graphic Item has no group to be sized inside.
 */
const graphicGroupChildSizingSchema = z.object({
	mode: z.enum(['fixed', 'fill']),
	size: nonNegativePixelSchema,
	weight: finiteNumberSchema.min(0).max(100),
}).strict();

/**
 * A Graphic Group child is any base Graphic Item kind except another Graphic
 * Group: the union simply omits it, so non-nesting is a property of the wire
 * schema rather than a rule something has to check.
 */
const graphicGroupChildConfigSchema = z.discriminatedUnion('type', [
	z.object({
		...textGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...shapeGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...mediaGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...socialNetworkIconGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...clockGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...playerLifeGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...gameWinsGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
	z.object({
		...deckListGraphicItemShape,
		sizing: graphicGroupChildSizingSchema.optional(),
	}).strict(),
]);

export const MAX_GRAPHIC_GROUP_CHILDREN = 50;

const graphicGroupItemConfigSchema = z.object({
	...graphicItemBaseShape,
	type: z.literal('group'),
	arrangement: z.enum(GRAPHIC_GROUP_ARRANGEMENT_VALUES),
	padding: nonNegativePixelSchema,
	gap: nonNegativePixelSchema,
	align: z.enum(GRAPHIC_GROUP_ALIGN_VALUES),
	justify: z.enum(GRAPHIC_GROUP_JUSTIFY_VALUES),
	clip: z.boolean(),
	geometry: shapeGeometrySchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
	defaultChildSurfaceStyle: graphicSurfaceStyleSchema.optional(),
	// A Graphic Group coordinates the animation of its direct items as well as
	// its own, so it widens the base item's animation rather than reusing it.
	animation: graphicContainerAnimationSchema.optional(),
	children: z.array(graphicGroupChildConfigSchema).max(
		MAX_GRAPHIC_GROUP_CHILDREN,
		`A Graphic Group must not contain more than ${MAX_GRAPHIC_GROUP_CHILDREN} Graphic Items`,
	),
}).strict().refine(
	// Its children, not the whole Broadcast Graphic's items: a group orders what it
	// contains, and the graphic orders its top-level items, of which the group is one.
	group => graphicStaggerNamesASubset(group, group.children.length),
	GRAPHIC_STAGGER_SUBSET_MESSAGE,
);

const graphicItemConfigSchema = z.discriminatedUnion('type', [
	textGraphicItemConfigSchema,
	shapeGraphicItemConfigSchema,
	mediaGraphicItemConfigSchema,
	socialNetworkIconGraphicItemConfigSchema,
	graphicGroupItemConfigSchema,
	clockGraphicItemConfigSchema,
	playerLifeGraphicItemConfigSchema,
	gameWinsGraphicItemConfigSchema,
	deckListGraphicItemConfigSchema,
]);

export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC = 100;

/**
 * The same bound, named for the other host that composes the same Graphic Items.
 *
 * A Feature Match Layout and a Broadcast Graphic are both one composition of the
 * shared vocabulary, so they get one number; it is spelled twice so an operator
 * reads a limit in their own vocabulary rather than one named after the other
 * Screen Mode. They are deliberately tied rather than merely equal — a render-cost
 * ceiling that differs between two hosts of the same compositor is the per-ticket
 * divergence #99 exists to end.
 */
export const MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC;

export const MAX_BROADCAST_GRAPHICS_PER_SCREEN = 50;

/**
 * The whole-Screen Graphic Item budget, counting Graphic Group children.
 *
 * It binds a product the per-list caps leave unbounded: 50 Broadcast Graphics x 100
 * Graphic Items x 50 Graphic Group children is 255,000 Graphic Items against a
 * 512 KiB budget shared by every Screen Mode.
 *
 * **300 is `MAX_BROADCAST_GRAPHICS_PER_SCREEN` x the six Graphic Items of the
 * richest reconstruction in the fidelity acceptance set** — every Broadcast
 * Graphic the Screen admits, authored at the richest shape that evidence
 * contains. The inventory those six are counted from is reproduced in
 * `DECISIONS.md` (ADR-0007); the prototype document it was
 * originally read off is no longer in the repository. A realistic Screen at this
 * cap measures 248,734 bytes, 47% of the shared budget.
 *
 * `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES` is what the
 * caps together admit: every construct the schema accepts, each populated at its
 * own maximum, with the one exception named beside the fixture — a Graphic Style
 * Set link's `revision` has no upper bound to populate. The claim is qualified
 * rather than absolute on purpose; four rounds of correction here came of an
 * absolute one. It is
 * about seven times the budget and **that is a settled decision, not an oversight**:
 * the worst case is allowed not to fit, because the byte total is enforced on the
 * editors' write path (#85) and realtime no longer publishes mode configurations
 * (#95). The measurement is pinned in two arrangements in
 * `broadcastGraphicsModeConfig.test.ts`, so "which worst case" stays a checked
 * choice rather than an assumption.
 *
 * The reasoning, the arithmetic that shows no narrowing reaches a fitting worst
 * case, what is given up, and what a later ticket should do instead of re-deriving
 * this number are all in **`DECISIONS.md` (ADR-0007)**. Read
 * that before moving this constant.
 *
 * Two notes that belong beside the code rather than in the record:
 *
 * - Media Graphic Items contribute nothing to the worst case. A maximal animated
 *   Media Graphic Item is 1,906 bytes against 3,704 for a maximal animated Text
 *   Graphic Item, so the worst case is built from text and a cheaper kind cannot
 *   raise it.
 * - For any package whose graphics declare Live Control it is not this cap that
 *   binds first but `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN`: at two
 *   Graphic Inputs per graphic, 60 covers 30 of the 50 Broadcast Graphics. Move
 *   that number before this one.
 *
 * No cross-mode headroom figure is stated here. The budget is shared with every
 * other Screen Mode, so what remains is a property of the whole `modeConfigs` map
 * rather than of this cap — reconstructing it per ticket is how two tickets came to
 * quote different baselines for the same pre-existing Graphic Item.
 */
export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN = 300;
export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES = 3_715_514;

function countGraphicItems(items: readonly { type: string; children?: readonly unknown[] }[]): number {
	return items.reduce(
		(total, item) => total + 1 + (item.type === 'group'
			? (item.children?.length ?? 0)
			: 0),
		0,
	);
}

function graphicItemIds(items: readonly { id: string; type: string; children?: readonly { id: string }[] }[]) {
	return items.flatMap(item => [
		item.id,
		...(item.type === 'group'
			? (item.children ?? []).map(child => child.id)
			: []),
	]);
}

function hasSocialNetworkIcon(items: readonly { type: string; children?: readonly { type: string }[] }[]): boolean {
	return items.some(item => item.type === 'social-network-icon'
		|| (item.type === 'group' && item.children?.some(child => child.type === 'social-network-icon')));
}

/** A projected placeholder style is meaningful only in Broadcast Graphics. */
function hasSocialProfilePlaceholderStyle(items: readonly GraphicItemConfig[]): boolean {
	function projectedStyle(item: GraphicItemConfig | GraphicGroupChildConfig): boolean {
		return item.type === 'text' && Object.keys(item.placeholderStyles ?? {})
			.some(key => readSocialProfileProjectedValueReference(key) !== undefined);
	}
	return items.some(item => projectedStyle(item)
		|| (item.type === 'group' && item.children.some(projectedStyle)));
}

/** Every projected consumer stays inside the Presentation Group that supplies it. */
function socialProfileProjectionConsumersResolve(graphic: BroadcastGraphicConfig): boolean {
	const presentationGroupByProjection = new Map(
		(graphic.socialProfileProjections ?? []).map(projection => [projection.key, projection.presentationGroupId]),
	);

	function resolves(
		item: GraphicItemConfig | GraphicGroupChildConfig,
		containingGroupId: string | undefined,
	): boolean {
		if (item.type === 'social-network-icon' && typeof item.network !== 'string') {
			const presentationGroupId = presentationGroupByProjection.get(item.network.projectionKey);
			return presentationGroupId !== undefined && presentationGroupId === containingGroupId;
		}
		if (item.type !== 'text')
			return true;
		const styleReferences = Object.keys(item.placeholderStyles ?? {})
			.map(readSocialProfileProjectedValueReference)
			.filter(reference => reference !== undefined);
		if (presentationGroupByProjection.size === 0)
			return styleReferences.length === 0;
		if (
			graphicTextTemplateDottedPlaceholderKeys(item.text)
				.some(key => readSocialProfileProjectedValueReference(key) === undefined)
		) {
			return false;
		}
		const references = [
			...graphicTextTemplateProjectedValueReferences(item.text),
			...styleReferences,
		];
		return references.every((reference) => {
			const presentationGroupId = presentationGroupByProjection.get(reference.projectionKey);
			return presentationGroupId !== undefined && presentationGroupId === containingGroupId;
		});
	}

	return graphic.items.every((item) => {
		if (item.type !== 'group')
			return resolves(item, undefined);
		return item.children.every(child => resolves(child, item.id));
	});
}

export const broadcastGraphicConfigSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(100),
	// The one Graphic Channel this Broadcast Graphic runs in. Deliberately not checked
	// against the Screen's declared channels: that is a cross-field rule, and an
	// object-level refinement never reaches the patch path the editors write through,
	// so it would hold on one write path and not the other. Membership of a channel the
	// Screen does not declare resolves to no membership instead, uniformly.
	channelId: z.string().min(1).max(100).optional(),
	// Named caps: these are reached before the mode-configuration byte limit, so
	// the operator learns which cap they hit rather than reading a byte count.
	items: z.array(graphicItemConfigSchema)
		.max(
			MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
			`A Broadcast Graphic must not contain more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC} Graphic Items`,
		)
		// Graphic Item ids are unique within one Broadcast Graphic, including a
		// Graphic Group's children. Every authoring operation addresses an item by
		// id alone and resolves it against both levels, so a duplicate would edit,
		// move, or delete the wrong item. The check belongs on this field rather
		// than on the object: the mode-configuration patch schema rebuilds each
		// mode from its field schemas and drops object-level refinements.
		.refine(
			items => new Set(graphicItemIds(items)).size === graphicItemIds(items).length,
			'Graphic Item ids must be unique within one Broadcast Graphic',
		),
	// Every cap and uniqueness rule sits on its own array field for the same reason
	// the Graphic Item ones do: an object-level refinement never reaches the patch
	// path the editors write through.
	inputs: z.array(graphicInputDeclarationSchema)
		.max(
			MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
			`A Broadcast Graphic must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC} Graphic Inputs`,
		)
		// A `{inputKey}` placeholder, a Graphic Input Binding, and a Live Control
		// edit all address an input by key alone, so a duplicate key would render,
		// bind, and edit whichever one happened to be found first.
		.refine(
			inputs => new Set(inputs.map(input => input.key)).size === inputs.length,
			'Graphic Input keys must be unique within one Broadcast Graphic',
		)
		.optional(),
	sources: z.array(graphicSourceSelectionSchema)
		.max(
			MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
			`A Broadcast Graphic must not declare more than ${MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC} Graphic Source Selections`,
		)
		.refine(
			sources => new Set(sources.map(source => source.key)).size === sources.length,
			'Graphic Source Selection keys must be unique within one Broadcast Graphic',
		)
		// A derived Graphic Source Selection is only meaningful if the relationship it
		// names exists and yields the kind it declares — otherwise it is a selection
		// that can never resolve, and an operator would have no picker to fix it with.
		.refine(
			graphicSourceDerivationsResolve,
			'A derived Graphic Source Selection must follow a declared selection through a relationship that yields its own kind',
		)
		.refine(
			graphicSourceDerivationsAcyclic,
			'Graphic Source Selections must not derive from one another in a cycle',
		)
		.optional(),
	bindings: z.array(graphicInputBindingSchema)
		.max(
			MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
			`A Broadcast Graphic must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC} Graphic Input Bindings`,
		)
		// A Graphic Input Binding maps one Graphic Input to one field, so a second
		// binding for the same input would leave which one resolves undecided.
		.refine(
			bindings => new Set(bindings.map(binding => binding.inputKey)).size === bindings.length,
			'A Graphic Input may have at most one Graphic Input Binding',
		)
		.optional(),
	socialProfileProjections: z.array(socialProfileProjectionSchema)
		.max(
			MAX_SOCIAL_PROFILE_PROJECTIONS_PER_BROADCAST_GRAPHIC,
			`A Broadcast Graphic must not declare more than ${MAX_SOCIAL_PROFILE_PROJECTIONS_PER_BROADCAST_GRAPHIC} Social Profile Projections`,
		)
		.refine(
			projections => new Set(projections.map(projection => projection.key)).size === projections.length,
			'Social Profile Projection keys must be unique within one Broadcast Graphic',
		)
		.optional(),
	animation: graphicContainerAnimationSchema.optional(),
	styleSet: graphicStyleSetLinkSchema.optional(),
	styleRefs: graphicContainerStyleRefsSchema.optional(),
}).strict().refine(
	// Top-level items only: a Graphic Group's children are staggered by the group.
	graphic => graphicStaggerNamesASubset(graphic, graphic.items.length),
	GRAPHIC_STAGGER_SUBSET_MESSAGE,
).refine(
	(graphic) => {
		const sources = new Map((graphic.sources ?? []).map(source => [source.key, source]));
		return (graphic.socialProfileProjections ?? []).every(
			projection => sources.get(projection.sourceKey)?.kind === 'talent',
		);
	},
	'A Social Profile Projection must reference a declared Talent Graphic Source Selection',
).refine(
	(graphic) => {
		const projections = graphic.socialProfileProjections ?? [];
		const groups = new Set(graphic.items.filter(item => item.type === 'group').map(group => group.id));
		return projections.every(projection => groups.has(projection.presentationGroupId))
			&& new Set(projections.map(projection => projection.presentationGroupId)).size === projections.length;
	},
	'Every Social Profile Projection must reference its own ordinary Graphic Group',
).refine(
	graphic => socialProfileProjectionConsumersResolve(graphic as BroadcastGraphicConfig),
	'Projected text values and dynamic Social Network Icons must reference the projection of their containing Presentation Group',
);

/**
 * A Feature Match Layout's shared item tree.
 *
 * The same Graphic Items and the same whole-composition animation a Broadcast
 * Graphic carries, and deliberately none of its Graphic Inputs, Graphic Source
 * Selections, or Graphic Input Bindings. A Feature Match Overlay binds a fixed
 * host token catalogue instead of declaring inputs, so accepting the fields would
 * let a write store declarations nothing resolves and nothing can accept — the
 * Host Contract's `textValues` rule, restated where the wire is checked.
 */
const featureMatchLayoutCompositionSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(100),
	items: z.array(graphicItemConfigSchema)
		.max(
			MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT,
			`A Feature Match Layout must not contain more than ${MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT} Graphic Items`,
		)
		// Counting Graphic Group children, exactly as a Broadcast Graphics Screen's
		// total does. Without it the cap above bounded only the top-level list, so 100
		// groups of 50 children was 5,100 Graphic Items in one layout — refused, if at
		// all, by the byte total rather than by a limit anyone could read.
		.refine(
			items => countGraphicItems(items) <= MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT,
			`A Feature Match Layout must not contain more than ${MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT} Graphic Items in total`,
		)
		.refine(
			items => new Set(graphicItemIds(items)).size === graphicItemIds(items).length,
			'Graphic Item ids must be unique within one Feature Match Layout',
		)
		.refine(
			items => !hasSocialNetworkIcon(items),
			'Social Network Icon Graphic Items are available only in Broadcast Graphics',
		)
		.refine(
			items => !hasSocialProfilePlaceholderStyle(items),
			'Social Profile Projection placeholder styles are available only in Broadcast Graphics',
		),
	animation: graphicContainerAnimationSchema.optional(),
}).strict().refine(
	composition => graphicStaggerNamesASubset(composition, composition.items.length),
	GRAPHIC_STAGGER_SUBSET_MESSAGE,
);

/**
 * How many external video source areas one Feature Match Layout may frame.
 *
 * Its own cap rather than a share of the Graphic Item budget: a Source Item is a
 * host-owned Definition on its own list, and a broadcast has as many cameras as it
 * has cameras.
 */
export const MAX_FEATURE_MATCH_SOURCE_ITEMS = 20;

/**
 * A Broadcast Graphics Screen's authored stack of Broadcast Graphics: the
 * server's schema for its config contract's `graphics` field.
 *
 * Every cap lives on the array itself rather than on the mode object, so it
 * reaches the PATCH path, which validates each field on its own.
 */
const broadcastGraphicsStackSchema = z.array(broadcastGraphicConfigSchema)
	.max(
		MAX_BROADCAST_GRAPHICS_PER_SCREEN,
		`A Broadcast Graphics Screen must not carry more than ${MAX_BROADCAST_GRAPHICS_PER_SCREEN} Broadcast Graphics`,
	)
	.refine(
		graphics => graphics.reduce((total, graphic) => total + countGraphicItems(graphic.items), 0)
			<= MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
		`A Broadcast Graphics Screen must not carry more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Items in total`,
	)
	.refine(
		graphics => graphics.reduce((total, graphic) => total + (graphic.inputs?.length ?? 0), 0)
			<= MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
		`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Inputs in total`,
	)
	// Bindings are budgeted with the inputs they map, and Graphic Source
	// Selections with them: all three are per-graphic lists whose product with the
	// Broadcast Graphic cap would otherwise be unbounded.
	.refine(
		graphics => graphics.reduce((total, graphic) => total + (graphic.bindings?.length ?? 0), 0)
			<= MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
		`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Input Bindings in total`,
	)
	.refine(
		graphics => graphics.reduce((total, graphic) => total + (graphic.sources?.length ?? 0), 0)
			<= MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
		`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Source Selections in total`,
	)
	.refine(
		graphics => graphics.reduce(
			(total, graphic) => total + (graphic.socialProfileProjections?.length ?? 0),
			0,
		) <= MAX_SOCIAL_PROFILE_PROJECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
		`A Broadcast Graphics Screen must not declare more than ${MAX_SOCIAL_PROFILE_PROJECTIONS_PER_BROADCAST_GRAPHICS_SCREEN} Social Profile Projections in total`,
	);

/**
 * One Feature Match Layout: the Frame, its host-owned Source Items, and the
 * shared item tree. The server's schema for the Feature Match Overlay config
 * contract's `layout` field.
 *
 * It sits here, after the Shared Graphics Foundation section, because that tree is
 * the Shared Graphics Foundation vocabulary above. Every cap lives on its own array
 * for the same reason every Broadcast Graphics cap does.
 *
 * Named and exported because it is the boundary of the portable artifact as well
 * as a field of the mode configuration. A Feature Match Layout Template's document
 * is exactly this and a Template Package's payload proves a received one against
 * this same schema — so a layout that installs is a layout the Screen write path
 * will accept, and the two can never come apart.
 *
 * Being `.strict()` is what makes "Event identities stripped" enforceable rather
 * than merely observed. A Feature Match Slot assignment lives on the mode
 * configuration beside this object and never inside it, so a document that carries
 * one — hand-edited, or written by something that thought a layout was Screen
 * state — is refused on the unknown key rather than installed and quietly ignored.
 */
export const featureMatchLayoutConfigSchema = z.object({
	frame: featureMatchOverlayFrameConfigSchema,
	// Host-owned Source Items: top-level only, with Frame cutout behaviour the
	// shared vocabulary has no way to express. Their list order is their Graphic
	// Layer Order beneath the composition.
	sources: z.array(featureMatchSourceItemConfigSchema).max(MAX_FEATURE_MATCH_SOURCE_ITEMS),
	composition: featureMatchLayoutCompositionSchema,
}).strict();

/**
 * Every Screen Mode's write forms, from its config contract. The server supplies
 * the schema of each field that reaches server-only Graphic Asset ids (ADR-0037).
 */
const modeConfigForms = {
	'background': configContractModeForms('background', { layers: backgroundLayerStackSchema }),
	'card': configContractModeForms('card'),
	'deck': configContractModeForms('deck'),
	'standings': configContractModeForms('standings'),
	'top-cut': configContractModeForms('top-cut'),
	'feature-match': configContractModeForms('feature-match'),
	'feature-match-overlay': configContractModeForms('feature-match-overlay', { layout: featureMatchLayoutConfigSchema }),
	'broadcast-graphics': configContractModeForms('broadcast-graphics', { graphics: broadcastGraphicsStackSchema }),
	'metagame': configContractModeForms('metagame'),
	'top-cards': configContractModeForms('top-cards'),
	'player-history': configContractModeForms('player-history'),
	'pairings': configContractModeForms('pairings'),
	'archetype-spotlight': configContractModeForms('archetype-spotlight'),
	'head-to-head': configContractModeForms('head-to-head'),
} satisfies Record<ScreenMode, unknown>;

type ModeConfigForms = typeof modeConfigForms;

function modeConfigFormMap<Form extends keyof ModeConfigForms[ScreenMode]>(form: Form) {
	return Object.fromEntries(
		Object.entries(modeConfigForms).map(([mode, forms]) => [mode, forms[form]]),
	) as { [M in ScreenMode]: ModeConfigForms[M][Form] };
}

/** Each mode's complete config: what a rendering reads once a stored fragment is completed. */
export const modeConfigCompleteSchemaMap = modeConfigFormMap('schema');

/** What Screen create and full update accept for each mode: a fragment of its complete config. */
export const modeConfigSchemaMap = modeConfigFormMap('stored');

/** Each mode's PATCH body. */
export const modeConfigPatchSchemaMap = modeConfigFormMap('patch');

export const backgroundModeConfigSchema = modeConfigCompleteSchemaMap.background;
export const deckModeConfigSchema = modeConfigCompleteSchemaMap.deck;
export const standingsModeConfigSchema = modeConfigCompleteSchemaMap.standings;
export const featureMatchModeConfigSchema = modeConfigCompleteSchemaMap['feature-match'];
export const featureMatchOverlayModeConfigSchema = modeConfigCompleteSchemaMap['feature-match-overlay'];
export const broadcastGraphicsModeConfigSchema = modeConfigCompleteSchemaMap['broadcast-graphics'];
export const metagameModeConfigSchema = modeConfigCompleteSchemaMap.metagame;
export const topCardsModeConfigSchema = modeConfigCompleteSchemaMap['top-cards'];
export const playerHistoryModeConfigSchema = modeConfigCompleteSchemaMap['player-history'];
export const pairingsModeConfigSchema = modeConfigCompleteSchemaMap.pairings;
export const archetypeSpotlightModeConfigSchema = modeConfigCompleteSchemaMap['archetype-spotlight'];
export const headToHeadModeConfigSchema = modeConfigCompleteSchemaMap['head-to-head'];

/**
 * The rules that are properties of the whole stored mode configuration rather than
 * of any one mode.
 *
 * Written once and applied to both schemas below, so the two write paths cannot
 * drift apart: a rule added here is enforced on Screen create, on full update, and
 * on every mode-configuration PATCH, without being restated anywhere.
 */
function withModeConfigsMapRules<T extends z.ZodTypeAny>(schema: T) {
	return schema.refine(
		value => jsonByteLength(value) <= MAX_MODE_CONFIGS_BYTES,
		`Mode configuration must not exceed ${MAX_MODE_CONFIGS_BYTES} bytes`,
	);
}

/**
 * A Screen Mode key as written, read as the key it is now: a client built before a
 * key was renamed still sends the former one (ADR-0043). Anything else is left for
 * the schema to accept or refuse.
 */
function currentScreenModeKey(value: unknown): unknown {
	return typeof value === 'string' && Object.hasOwn(FORMER_SCREEN_MODE_KEYS, value)
		? FORMER_SCREEN_MODE_KEYS[value]
		: value;
}

/** A Screen Mode, accepting a former key as the mode it names now. */
export const screenModeSchema = z.preprocess(currentScreenModeKey, z.enum(SCREEN_MODE_VALUES));

/**
 * A mode configurations map with each former key moved to its current one. A map
 * carrying both keeps the current key's config, the newer of the two.
 */
function withCurrentScreenModeKeys(value: unknown): unknown {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return value;
	const configs: Record<string, unknown> = { ...value };
	for (const [former, current] of Object.entries(FORMER_SCREEN_MODE_KEYS)) {
		if (!Object.hasOwn(configs, former))
			continue;
		if (!Object.hasOwn(configs, current))
			configs[current] = configs[former];
		delete configs[former];
	}
	return configs;
}

// Full modeConfigs map schema (all keys optional)
export const modeConfigsMapSchema = withModeConfigsMapRules(
	z.preprocess(withCurrentScreenModeKeys, z.object(modeConfigSchemaMap).strict().partial()),
);

/**
 * The whole-map rules alone, for a stored map whose individual modes may be partial.
 *
 * A mode configuration is legitimately incomplete in storage: PATCH writes
 * fragments and readers complete them from `getDefaultConfigForMode`, so a Screen
 * can hold `{ 'feature-match-overlay': { layout } }` with no `presetId` and be
 * entirely valid. Re-checking each mode against its full schema would therefore
 * reject ordinary edits, which is why this deliberately checks the map's own rules
 * and leaves each mode's shape to the patch schema that validated the fragment.
 */
const storedModeConfigsMapSchema = withModeConfigsMapRules(z.record(z.string(), z.unknown()));

/**
 * Object-level checks on a per-mode schema cannot reach the PATCH path, so having
 * one must fail loudly rather than be silently unenforced.
 *
 * This is the other half of #85. The byte total lives on the *map*, so it can be
 * applied to a merged result; a rule on one mode's own object cannot, because the
 * stored config it would judge is legitimately partial and completing it here would
 * invent values the operator never wrote. Rather than let such a rule be quietly
 * dropped — the exact defect #85 reports — this refuses to boot and says what to do.
 *
 * Nothing trips it today: every current cross-field constraint deliberately lives
 * on an array *field* (see the Graphic Item caps), which survives the patch
 * derivation. If you are reading this because it threw, the options are to move the
 * rule onto a field, or to extend `parseModeConfigPatchResult` to evaluate it
 * against a defaults-completed view of that mode.
 */
export function modeConfigSchemasWithObjectLevelChecks(
	schemas: Record<string, z.ZodTypeAny>,
): string[] {
	// In Zod 4 `.refine()` returns a ZodObject and records the check on the schema's
	// own definition, which is why the shape rebuild loses it while the type still
	// looks correct. Reading the checks back is therefore the only way to see one.
	return Object.entries(schemas)
		.filter(([, schema]) => ((schema as unknown as { _zod?: { def?: { checks?: unknown[] } } })
			._zod
			?.def
			?.checks
			?.length ?? 0) > 0)
		.map(([mode]) => mode);
}

function assertNoUnenforceableModeConfigRules(): void {
	const offenders = modeConfigSchemasWithObjectLevelChecks(modeConfigCompleteSchemaMap);

	if (offenders.length > 0) {
		throw new Error(
			`Mode config schemas carry object-level checks the PATCH path cannot enforce: ${offenders.join(', ')}. `
			+ 'Move the constraint onto a field, or extend parseModeConfigPatchResult to evaluate it. See #85.',
		);
	}
}

assertNoUnenforceableModeConfigRules();

/**
 * The mode configuration a patch would produce, validated as a whole.
 *
 * This is what makes an object-level rule real on the editors' write path. The
 * patch itself is validated field by field by `modeConfigPatchSchemaMap`; this
 * then merges it exactly as the write will and checks the *result* against the
 * whole-map rules, so the mode configuration byte total holds identically whether
 * a Screen was configured in one write or built up one patch at a time.
 *
 * The whole map is checked rather than only the patched mode, because that is what
 * the rule is about: the byte total is shared across all ten Screen Modes, so a
 * patch to one mode can only be judged against what the others already occupy.
 * Each mode's own shape is left to the patch schema that validated the fragment —
 * see `storedModeConfigsMapSchema` for why re-checking it here would be wrong.
 *
 * It throws a `ZodError`, which the route's own error handling already turns into
 * a 400 carrying the issues — the same shape the editors read a field-level
 * failure from, so a whole-object failure needs no special client handling.
 */
export function parseModeConfigPatchResult(
	currentConfigs: ModeConfigsMap | null | undefined,
	mode: ScreenMode,
	patch: Record<string, unknown>,
): ModeConfigsMap {
	return storedModeConfigsMapSchema.parse(
		mergeScreenModeConfig(currentConfigs ?? {}, mode, patch),
	) as ModeConfigsMap;
}

const boundedScreenConfigSchema = screenConfigSchema.refine(
	value => jsonByteLength(value) <= MAX_SCREEN_CONFIG_BYTES,
	`Screen configuration must not exceed ${MAX_SCREEN_CONFIG_BYTES} bytes`,
);

/* ────────────────────────────────────────────────
 * Screen CRUD schemas
 * ──────────────────────────────────────────────── */

// CREATE
export const createScreenSchema = createInsertSchema(screens)
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		eventId: true,
		activeCard: true,
		activeCardVersion: true,
		graphicAssetReferenceVersion: true,
		assetCapabilitySeed: true,
		assetCapabilityVersion: true,
		assetCapabilityDigest: true,
		// Only the Screen Theme Override write sets them, one token at a time.
		themeOverrides: true,
	})
	.extend({
		slug: screenSlugSchema,
		currentMode: screenModeSchema.optional(),
		modeConfigs: modeConfigsMapSchema.nullable().optional(),
		screenConfig: boundedScreenConfigSchema.nullable().optional(),
	})
	.strict();

// UPDATE
export const updateScreenSchema = createUpdateSchema(screens)
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		eventId: true,
		activeCard: true,
		activeCardVersion: true,
		graphicAssetReferenceVersion: true,
		assetCapabilitySeed: true,
		assetCapabilityVersion: true,
		assetCapabilityDigest: true,
		// Only the Screen Theme Override write sets them, one token at a time.
		themeOverrides: true,
	})
	.extend({
		slug: screenSlugSchema.optional(),
		currentMode: screenModeSchema.optional(),
		modeConfigs: modeConfigsMapSchema.nullable().optional(),
		screenConfig: boundedScreenConfigSchema.nullable().optional(),
		stateVersion: z.number().int().nonnegative(),
	})
	.strict();

export const screenCommandSchema = z.object({
	command: z.enum(SCREEN_COMMAND_VALUES),
}).strict();

/**
 * A Screen Theme Override write: each named token's new value, or `null` to
 * clear it (ADR-0041). Each value is checked against the token's type and the
 * Screen's mode by the write, which knows the vocabulary.
 */
export const screenThemeOverridesPatchSchema = z.object({
	stateVersion: z.number().int().nonnegative().optional(),
	tokens: z.record(
		z.string(),
		z.unknown().refine(value => value !== undefined, 'A value, or null to clear, is required'),
	).refine(tokens => Object.keys(tokens).length > 0, 'Name at least one token'),
}).strict();

// ROUTE PARAMS
export const screenParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	screenId: z.coerce.number().int().positive(),
});

// Mode config update params
export const modeConfigParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	screenId: z.coerce.number().int().positive(),
	mode: screenModeSchema,
});

/* TYPES */
export type CreateScreenInput = z.infer<typeof createScreenSchema>;
export type ScreenCommandInput = z.infer<typeof screenCommandSchema>;
export type UpdateScreenInput = z.infer<typeof updateScreenSchema>;
export type ScreenParams = z.infer<typeof screenParamsSchema>;
export type ModeConfigParams = z.infer<typeof modeConfigParamsSchema>;
