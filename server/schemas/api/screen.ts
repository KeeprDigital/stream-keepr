import type { ScreenMode } from '~~/shared/types/enums';
import type { BroadcastGraphicsModeConfig, FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig, IdleModeConfig, ModeConfigsMap } from '~~/shared/types/screenConfig';
import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { SCREEN_MODE_VALUES, screens } from '~~/server/db/schema';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION } from '~~/shared/featureMatchSourceItems';
import {
	GRAPHIC_FONT_IDS,
	graphicSourceRelationKind,
	isKnownGraphicBindingFieldId,
} from '~~/shared/modules/graphics';
import {
	CARD_ANIMATION_SPEED_VALUES,
	DECK_CARD_SIZE_VALUES,
	DECK_VIEW_MODE_VALUES,
	HORIZONTAL_ALIGN_VALUES,
	METAGAME_ARCHETYPE_COLUMN_KEY_VALUES,
	METAGAME_CARD_COLUMN_KEY_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	METAGAME_SCOPE_VALUES,
	METAGAME_SORT_BY_VALUES,
	METAGAME_VIEW_MODE_VALUES,
	PLAYER_HISTORY_COLUMN_KEY_VALUES,
	PLAYER_SIDE_VALUES,
	QUANTITY_POSITION_VALUES,
	QUANTITY_SIZE_VALUES,
	REVEAL_ORDER_VALUES,
	REVEAL_TRIGGER_VALUES,
	SCREEN_COLOR_MODE_VALUES,
	SCREEN_COMMAND_VALUES,
	SIDEBOARD_LAYOUT_VALUES,
	STANDINGS_COLUMN_KEY_VALUES,
	STANDINGS_VIEW_MODE_VALUES,
	VERTICAL_ALIGN_VALUES,
} from '~~/shared/types/enums';
import {
	MEDIA_GRAPHIC_ITEM_FIT_VALUES,
	MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES,
} from '~~/shared/types/graphicItem';
import {
	GAME_WINS_BOX_ORIENTATION_VALUES,
	GAME_WINS_DISPLAY_MODE_VALUES,
	GRAPHIC_ANCHOR_POINT_VALUES,
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
	GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES,
	GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES,
	GRAPHIC_FONT_STYLE_VALUES,
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
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_PAUSE_MS,
	MAX_GRAPHIC_ANIMATION_REPEAT,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
	MAX_GRAPHIC_FILL_STOPS,
	MAX_GRAPHIC_INPUT_CHOICE_LENGTH,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MAX_GRAPHIC_SLIDE_DISTANCE_PX,
	MAX_GRAPHIC_TEXT_LENGTH,
	MAX_PLAYER_LIFE_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_REPEAT,
	MIN_GRAPHIC_FILL_STOPS,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MIN_PLAYER_LIFE_ANIMATION_DURATION_MS,
	ON_AIR_UPDATE_POLICY_VALUES,
	PLAYER_LIFE_ANIMATION_VALUES,
	SHAPE_CORNER_TREATMENT_VALUES,
	TEXT_OVERFLOW_POLICY_VALUES,
} from '~~/shared/types/graphics';
import {
	FEATURE_MATCH_OVERLAY_ANCHOR_VALUES,
	FEATURE_MATCH_OVERLAY_FRAME_ANIMATION_EFFECT_VALUES,
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
	Object.entries(screenConfigSchema.shape).map(([key, schema]) => [key, schema.unwrap().nullable().optional()]),
) as z.ZodRawShape;

export const screenSlugSchema = z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens');

// Patch variant: accepts `null` as a sentinel meaning "delete this key from stored config".
// Used by the PATCH endpoint to support clearing width/height back to auto.
export const screenConfigPatchSchema = z.object(screenConfigPatchShape).strict();

function createModeConfigPatchFieldSchema(schema: any): z.ZodTypeAny {
	if (schema instanceof z.ZodOptional) {
		const inner = schema.unwrap();
		if (inner instanceof z.ZodNullable) {
			return (inner.unwrap() as any).nullable().optional();
		}

		return (inner as any).nullable().optional();
	}

	if (schema instanceof z.ZodNullable) {
		return (schema.unwrap() as any).nullable().optional();
	}

	return schema.optional();
}

/**
 * The schema one mode's PATCH body is validated against.
 *
 * Rebuilt from the full schema's shape, so it carries every field's own bounds
 * and accepts `null` as the "delete this key" sentinel. It deliberately does
 * **not** carry the full schema's object-level checks: a patch is a fragment, and
 * a whole-object rule cannot be evaluated against a fragment — the byte total in
 * particular is a property of the *stored* configuration, not of an edit to it.
 *
 * That used to make object-level rules silently unenforced on this path, which is
 * the defect in #85. What closes it is `parseModeConfigPatchResult`: the
 * configuration a patch would produce is validated against `modeConfigsMapSchema`
 * — the same authoritative schema Screen create and full update use — before
 * anything is written. So dropping the checks here is safe *because* they are
 * applied there, and any object-level rule added in future is enforced on this
 * path automatically, with nobody needing to remember.
 */
function createModeConfigPatchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
	const patchShape = Object.fromEntries(
		Object.entries(schema.shape).map(([key, fieldSchema]) => [key, createModeConfigPatchFieldSchema(fieldSchema as any)]),
	) as z.ZodRawShape;

	return z.object(patchShape).strict();
}

/* ────────────────────────────────────────────────
 * Mode config Zod schemas (strict — no unknown keys)
 * ──────────────────────────────────────────────── */

// Shared enums
const deckViewModeSchema = z.enum(DECK_VIEW_MODE_VALUES);
const deckCardSizeSchema = z.enum(DECK_CARD_SIZE_VALUES);
const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);
const quantitySizeSchema = z.enum(QUANTITY_SIZE_VALUES);
const sideboardLayoutSchema = z.enum(SIDEBOARD_LAYOUT_VALUES);
const cardAnimationSpeedSchema = z.enum(CARD_ANIMATION_SPEED_VALUES);
const finiteNumberSchema = z.number().finite();
const opacitySchema = finiteNumberSchema.min(0).max(1);
const pixelSizeSchema = finiteNumberSchema.positive().max(10000);
const pixelPositionSchema = finiteNumberSchema.min(-10000).max(10000);
const nonNegativePixelSchema = finiteNumberSchema.nonnegative().max(10000);
const cssColorSchema = z.string().min(1).max(500);
const optionalCssColorSchema = cssColorSchema.optional();
const safeMediaUrlSchema = z.string().max(2000).refine((value) => {
	if (value === '')
		return true;
	if (value.startsWith('/') && !value.startsWith('//'))
		return true;
	try {
		const parsed = new URL(value);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
			&& parsed.username === ''
			&& parsed.password === '';
	}
	catch {
		return false;
	}
}, 'Media URL must be an HTTP(S) URL or a root-relative path');
const graphicAssetReferenceSchema = z.object({
	assetId: z.string().min(1).max(100).transform(graphicAssetId),
	revisionId: z.string().min(1).max(100).transform(graphicAssetRevisionId),
}).strict();

const screenMediaBackgroundConfigSchema = z.object({
	enabled: z.boolean(),
	type: z.literal('video'),
	url: safeMediaUrlSchema,
	fit: z.enum(['cover', 'contain', 'fill']),
	opacity: opacitySchema,
	playbackRate: finiteNumberSchema.positive().min(0.1).max(16),
	loop: z.boolean(),
}).strict();

// Per-mode config schemas
export const idleModeConfigSchema = z.object({
	mediaBackground: screenMediaBackgroundConfigSchema.optional(),
}).strict() satisfies z.ZodType<IdleModeConfig>;

export const cardDisplayConfigSchema = z.object({
	scale: z.number().min(0.1).max(5).optional(),
	animationEnabled: z.boolean().optional(),
	animationSpeed: cardAnimationSpeedSchema.optional(),
}).strict();

export const cardModeConfigSchema = cardDisplayConfigSchema.extend({
	featureMatchId: z.number().int().positive().nullable().optional(),
}).strict();

export const deckModeConfigSchema = z.object({
	playerId: z.number().int().positive().nullable(),
	viewMode: deckViewModeSchema,
	columns: z.number().int().min(1).max(20).optional(),
	listColumns: z.number().int().min(1).max(4).optional(),
	cardSize: deckCardSizeSchema.optional(),
	showQuantities: z.boolean().optional(),
	showDeckName: z.boolean().optional(),
	showDeckColors: z.boolean().optional(),
	showDeckStats: z.boolean().optional(),
	showDeckMetaPill: z.boolean().optional(),
	deckMetaPillSize: quantitySizeSchema.optional(),
	deckMetaPillTextColor: z.string().max(50).optional(),
	deckMetaPillBgColor: z.string().max(200).optional(),
	deckMetaPillAccentColor: z.string().max(50).optional(),
	deckMetaPillBorderColor: z.string().max(50).optional(),
	showHighlanderTotal: z.boolean().optional(),
	showHighlanderPointedCards: z.boolean().optional(),
	highlanderPointedCardsSize: quantitySizeSchema.optional(),
	highlanderPointedCardsTextColor: z.string().max(50).optional(),
	highlanderPointedCardsBgColor: z.string().max(200).optional(),
	highlanderPointedCardsAccentColor: z.string().max(50).optional(),
	highlanderPointedCardsBorderColor: z.string().max(50).optional(),
	showHighlanderPoints: z.boolean().optional(),
	highlanderPointsPosition: quantityPositionSchema.optional(),
	highlanderPointsSize: quantitySizeSchema.optional(),
	highlanderPointsTextColor: z.string().max(50).optional(),
	highlanderPointsBgColor: z.string().max(50).optional(),
	quantityPosition: quantityPositionSchema.optional(),
	quantitySize: quantitySizeSchema.optional(),
	quantityTextColor: z.string().max(50).optional(),
	quantityBgColor: z.string().max(50).optional(),
	dynamicCardSize: z.boolean().optional(),
	cardGap: z.number().min(0).optional(),
	showMainboard: z.boolean().optional(),
	showSideboard: z.boolean().optional(),
	sideboardLayout: sideboardLayoutSchema.optional(),
	stackOverlap: z.number().min(0).optional(),
}).strict();

const standingsColumnConfigSchema = z.object({
	key: z.enum(STANDINGS_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

const metagameArchetypeColumnConfigSchema = z.object({
	key: z.enum(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

const metagameCardColumnConfigSchema = z.object({
	key: z.enum(METAGAME_CARD_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

const playerHistoryColumnConfigSchema = z.object({
	key: z.enum(PLAYER_HISTORY_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

export const standingsModeConfigSchema = z.object({
	viewMode: z.enum(STANDINGS_VIEW_MODE_VALUES),

	columns: z.array(standingsColumnConfigSchema).min(1).max(10),
	showArchetypeColors: z.boolean(),
	maxTableWidth: z.number().int().positive().optional(),
	roundId: z.number().int().positive().optional(),

	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),

	topNCount: z.number().int().min(1).max(500),

	sliceStart: z.number().int().min(1).max(9999),
	sliceEnd: z.number().int().min(1).max(9999),

	playerListId: z.number().int().positive().optional(),

	revealCount: z.number().int().min(1).max(64),
	revealOrder: z.enum(REVEAL_ORDER_VALUES),
	revealTrigger: z.enum(REVEAL_TRIGGER_VALUES),
	revealIntervalMs: z.number().int().min(1000).max(30000),
	revealedCount: z.number().int().nonnegative().max(64),

	rowsPerPage: z.number().int().min(1).max(100),
	autoPageEnabled: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),

	currentPage: z.number().int().min(1).optional(),

	animateEntries: z.boolean(),
}).strict();

export const topCutModeConfigSchema = z.object({
	bracketSize: z.number().int().positive().optional(),
}).strict();

export const matchModeConfigSchema = z.object({
	featureMatchId: z.number().int().positive().nullable(),
	showNames: z.boolean(),
	showRecords: z.boolean(),
	showDeckNames: z.boolean(),
	showPronouns: z.boolean(),
	showClock: z.boolean(),
	showCounters: z.boolean(),
	showSeatLabels: z.boolean().optional(),
	leftSidePlayer: z.enum(PLAYER_SIDE_VALUES).optional(),
	showTurnControls: z.boolean().optional(),
	showOvertime: z.boolean().optional(),
	showMulliganInfo: z.boolean().optional(),
	showLgs: z.boolean().optional(),
	showTableNumber: z.boolean().optional(),
	allowLifeControls: z.boolean().optional(),
	allowGameWinControls: z.boolean().optional(),
	allowCounterControls: z.boolean().optional(),
}).strict();

export const playerHistoryModeConfigSchema = z.object({
	playerId: z.number().int().positive().nullable(),
	columns: z.array(playerHistoryColumnConfigSchema).min(1).max(6),
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),
	rowsPerPage: z.number().int().min(1).max(100),
	autoPageEnabled: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),
	currentPage: z.number().int().min(1).optional(),
}).strict();

const featureMatchOverlayPresetIdSchema = z.enum(['full-table', 'left-stacked-player-cams', 'neon-feature-match']);
const featureMatchOverlayAnchorValueSchema = z.enum(FEATURE_MATCH_OVERLAY_ANCHOR_VALUES);
const featureMatchOverlayFrameAnimationEffectSchema = z.enum(FEATURE_MATCH_OVERLAY_FRAME_ANIMATION_EFFECT_VALUES);

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
}).strict();

const featureMatchOverlayFrameAnimationConfigSchema = z.object({
	enabled: z.boolean(),
	effect: featureMatchOverlayFrameAnimationEffectSchema,
	opacity: opacitySchema,
	highlightColor: optionalCssColorSchema,
	midtoneColor: optionalCssColorSchema,
	lowlightColor: optionalCssColorSchema,
	baseColor: optionalCssColorSchema,
	color1: optionalCssColorSchema,
	color2: optionalCssColorSchema,
	backgroundColor: optionalCssColorSchema,
	blurFactor: opacitySchema.optional(),
	speed: finiteNumberSchema.nonnegative().max(20).optional(),
	zoom: finiteNumberSchema.positive().max(20).optional(),
	amplitudeFactor: finiteNumberSchema.nonnegative().max(20).optional(),
	ringFactor: finiteNumberSchema.nonnegative().max(50).optional(),
	rotationFactor: finiteNumberSchema.nonnegative().max(20).optional(),
	xOffset: finiteNumberSchema.min(-1).max(1).optional(),
	yOffset: finiteNumberSchema.min(-1).max(1).optional(),
	color: optionalCssColorSchema,
	shininess: finiteNumberSchema.nonnegative().max(500).optional(),
	waveHeight: finiteNumberSchema.nonnegative().max(500).optional(),
	waveSpeed: finiteNumberSchema.nonnegative().max(20).optional(),
	points: finiteNumberSchema.int().min(1).max(1000).optional(),
	maxDistance: finiteNumberSchema.nonnegative().max(1000).optional(),
	spacing: finiteNumberSchema.positive().max(1000).optional(),
	showDots: z.boolean().optional(),
	size: finiteNumberSchema.positive().max(1000).optional(),
	showLines: z.boolean().optional(),
	mouseDriftEnabled: z.boolean(),
	mouseDriftMode: z.enum(['orbit', 'random']).optional(),
	mouseDriftSeconds: finiteNumberSchema.positive().max(600),
	mouseDriftRadius: finiteNumberSchema.nonnegative().max(1),
}).strict();

const featureMatchOverlayFrameConfigSchema = featureMatchOverlayBorderSidesSchema.extend({
	backgroundColor: cssColorSchema,
	opacity: opacitySchema,
	backgroundImage: graphicAssetReferenceSchema.optional(),
	backgroundImageFit: z.enum(['cover', 'contain', 'fill']).optional(),
	mediaBackground: screenMediaBackgroundConfigSchema.optional(),
	gradient: z.string().max(1000).optional(),
	animation: featureMatchOverlayFrameAnimationConfigSchema.optional(),
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

const graphicTypographySchema = z.object({
	fontId: z.enum(GRAPHIC_FONT_IDS),
	fontSize: finiteNumberSchema.positive().max(600),
	fontWeight: finiteNumberSchema.int().min(1).max(1000),
	fontStyle: z.enum(GRAPHIC_FONT_STYLE_VALUES),
	textTransform: z.enum(GRAPHIC_TEXT_TRANSFORM_VALUES),
	letterSpacing: finiteNumberSchema.min(-20).max(100),
	lineHeight: finiteNumberSchema.positive().max(10),
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

const graphicShapeCornerSchema = z.object({
	treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES),
	size: nonNegativePixelSchema,
}).strict();

const graphicShapeGeometrySchema = z.object({
	topLeft: graphicShapeCornerSchema,
	topRight: graphicShapeCornerSchema,
	bottomRight: graphicShapeCornerSchema,
	bottomLeft: graphicShapeCornerSchema,
	leftSlant: pixelPositionSchema,
	rightSlant: pixelPositionSchema,
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
	reveal: z.object({ edge: z.enum(GRAPHIC_REVEAL_EDGE_VALUES) }).strict().optional(),
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
 * A stagger names a subset of one container's direct Graphic Items, so it can
 * never name more ids than one Broadcast Graphic may hold Graphic Items. The cap
 * is stated here rather than reused from `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC`
 * because these schemas are built before that constant is initialised.
 *
 * Ids are not checked against the container's actual children: an author who
 * deletes a staggered item must not have their next write refused, so a stale id
 * is ignored at projection time instead.
 */
const MAX_GRAPHIC_ANIMATION_STAGGER_ITEMS = 100;

const graphicAnimationStaggerSchema = z.object({
	order: z.enum(GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES),
	step: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS),
	itemIds: z.array(z.string().min(1).max(100)).max(MAX_GRAPHIC_ANIMATION_STAGGER_ITEMS),
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
export const MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC = 8;

/**
 * The whole-Screen Graphic Input, Graphic Input Binding, and Graphic Source
 * Selection budgets, for the same reason the Graphic Item one exists: the
 * per-graphic caps and the per-Screen Broadcast Graphic cap bound each list
 * independently, and their product does not fit the mode-configuration byte limit.
 * A choice Graphic Input with a full option list is the expensive case, at about
 * 1,274 bytes against a Graphic Item's 2,682.
 */
export const MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN = 60;
export const MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN = 40;

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
		default: graphicAssetReferenceSchema.nullable(),
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
	fit: z.enum(MEDIA_GRAPHIC_ITEM_FIT_VALUES),
	focalPosition: z.object({ horizontal: opacitySchema, vertical: opacitySchema }).strict(),
	opacity: opacitySchema,
	clipGeometry: graphicShapeGeometrySchema.optional(),
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
	'geometry': graphicStyleRefSchema(graphicShapeGeometrySchema.partial()).optional(),
	'clipGeometry': graphicStyleRefSchema(graphicShapeGeometrySchema.partial()).optional(),
	'boxGeometry': graphicStyleRefSchema(graphicShapeGeometrySchema.partial()).optional(),
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
	revision: z.number().int().nonnegative(),
}).strict();

const graphicItemBaseShape = {
	id: z.string().min(1).max(100),
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
	fontId: z.enum(GRAPHIC_FONT_IDS).optional(),
	fontSize: finiteNumberSchema.positive().max(600).optional(),
	fontWeight: z.number().int().min(100).max(900).optional(),
	fontStyle: z.enum(GRAPHIC_FONT_STYLE_VALUES).optional(),
	textTransform: z.enum(GRAPHIC_TEXT_TRANSFORM_VALUES).optional(),
	letterSpacing: finiteNumberSchema.min(-100).max(100).optional(),
	color: cssColorSchema.optional(),
}).strict();

const textGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('text'),
	text: z.string().max(MAX_GRAPHIC_TEXT_LENGTH),
	typography: graphicTypographySchema,
	overflowPolicy: z.enum(TEXT_OVERFLOW_POLICY_VALUES),
	minFontSize: finiteNumberSchema.positive().max(600),
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
	placeholderStyles: z.record(
		graphicInputKeySchema,
		graphicPlaceholderStyleSchema,
	).refine(
		styles => Object.keys(styles).length <= MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM,
		`A Text Graphic Item must not define more than ${MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM} Graphic Placeholder Styles`,
	).optional(),
};

const shapeGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('shape'),
	geometry: graphicShapeGeometrySchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

/**
 * A Media Graphic Item.
 *
 * `asset` is optional because an author places the rectangle before choosing its
 * content, and `clipGeometry` because clipping is optional — absent, the item
 * clips to its own bounds. `videoCompatibility` records the pinned revision's own
 * target compatibility, which the Graphic Asset Reference index checks a
 * silent-video reference against.
 */
const mediaGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('media'),
	asset: graphicAssetReferenceSchema.optional(),
	mediaKind: z.enum(GRAPHIC_MEDIA_KIND_VALUES),
	fit: z.enum(MEDIA_GRAPHIC_ITEM_FIT_VALUES),
	focalPosition: z.object({
		horizontal: opacitySchema,
		vertical: opacitySchema,
	}).strict(),
	opacity: opacitySchema,
	clipGeometry: graphicShapeGeometrySchema.optional(),
	videoCompatibility: z.enum(MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES).optional(),
	playbackRate: finiteNumberSchema
		.min(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE)
		.max(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE),
	loop: z.boolean(),
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
	minFontSize: finiteNumberSchema.positive().max(600),
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

const playerLifeGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('player-life'),
	playerSide: z.enum(PLAYER_SIDE_VALUES),
	typography: graphicTypographySchema,
	overflowPolicy: z.enum(TEXT_OVERFLOW_POLICY_VALUES),
	minFontSize: finiteNumberSchema.positive().max(600),
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
	boxGeometry: graphicShapeGeometrySchema,
	boxSurfaceStyle: graphicSurfaceStyleSchema,
	wonBoxSurfaceStyle: graphicSurfaceStyleSchema,
	typography: graphicTypographySchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
};

const textGraphicItemConfigSchema = z.object(textGraphicItemShape).strict();
const shapeGraphicItemConfigSchema = z.object(shapeGraphicItemShape).strict();
const mediaGraphicItemConfigSchema = z.object(mediaGraphicItemShape).strict();
const clockGraphicItemConfigSchema = z.object(clockGraphicItemShape).strict();
const playerLifeGraphicItemConfigSchema = z.object(playerLifeGraphicItemShape).strict();
const gameWinsGraphicItemConfigSchema = z.object(gameWinsGraphicItemShape).strict();

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
	z.object({ ...textGraphicItemShape, sizing: graphicGroupChildSizingSchema.optional() }).strict(),
	z.object({ ...shapeGraphicItemShape, sizing: graphicGroupChildSizingSchema.optional() }).strict(),
	z.object({ ...mediaGraphicItemShape, sizing: graphicGroupChildSizingSchema.optional() }).strict(),
	z.object({ ...clockGraphicItemShape, sizing: graphicGroupChildSizingSchema.optional() }).strict(),
	z.object({ ...playerLifeGraphicItemShape, sizing: graphicGroupChildSizingSchema.optional() }).strict(),
	z.object({ ...gameWinsGraphicItemShape, sizing: graphicGroupChildSizingSchema.optional() }).strict(),
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
	geometry: graphicShapeGeometrySchema,
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
	defaultChildSurfaceStyle: graphicSurfaceStyleSchema.optional(),
	// A Graphic Group coordinates the animation of its direct items as well as
	// its own, so it widens the base item's animation rather than reusing it.
	animation: graphicContainerAnimationSchema.optional(),
	children: z.array(graphicGroupChildConfigSchema).max(
		MAX_GRAPHIC_GROUP_CHILDREN,
		`A Graphic Group must not contain more than ${MAX_GRAPHIC_GROUP_CHILDREN} Graphic Items`,
	),
}).strict();

const graphicItemConfigSchema = z.discriminatedUnion('type', [
	textGraphicItemConfigSchema,
	shapeGraphicItemConfigSchema,
	mediaGraphicItemConfigSchema,
	graphicGroupItemConfigSchema,
	clockGraphicItemConfigSchema,
	playerLifeGraphicItemConfigSchema,
	gameWinsGraphicItemConfigSchema,
]);

export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC = 100;
export const MAX_BROADCAST_GRAPHICS_PER_SCREEN = 50;

/**
 * The Graphic Channel cap.
 *
 * A Graphic Channel exists to make two Broadcast Graphics mutually exclusive, so a
 * channel with one member excludes nothing and a channel with none is not a lane at
 * all. Half the Broadcast Graphic cap is therefore the point past which another
 * channel cannot be given a second member, which makes it the cap that binds on
 * meaning rather than on an arbitrary number.
 */
export const MAX_GRAPHIC_CHANNELS_PER_SCREEN = 25;

/**
 * The whole-Screen Graphic Item budget.
 *
 * The per-graphic and per-Screen caps bound each list independently, but their
 * product does not come close to fitting `MAX_MODE_CONFIGS_BYTES`. Measured
 * against this schema's own maxima, the most expensive Graphic Item a Graphic
 * Group can hold serializes to 2,004 bytes (a 1,000-character Text Graphic Item
 * with a four-stop gradient, an outline, a glow, rotation, and main-axis sizing),
 * a Graphic Group shell to 1,510, and a Broadcast Graphic shell to 166. Without
 * a total cap, 50 Broadcast Graphics x 100 Graphic Groups x 50 children is
 * 255,000 Graphic Items and about 485 MiB against a 512 KiB budget shared by
 * every Screen Mode.
 *
 * This cap binds the product. It came down from 200 when Graphic Inputs arrived,
 * because they add two costs to the same budget: a Text Graphic Item may now carry
 * Graphic Placeholder Styles, which takes the most expensive Graphic Item from
 * 2,004 bytes to 2,682 (2,727 as a Graphic Group child), and each Broadcast
 * Graphic declares Graphic Inputs, bindings, and Graphic Source Selections of its
 * own. Measured against this schema's own maxima, the worst authored Screen every
 * cap together still admits is 110 maximal Graphic Items at about 2,700 bytes
 * each, 60 maximal choice Graphic Inputs at about 1,300, 60 Graphic Input
 * Bindings, 40 Graphic Source Selections, and 50 Broadcast Graphic shells:
 * `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES` measured
 * against the schema itself.
 *
 * **That figure no longer fits the budget.** It was 79% when Graphic Inputs set
 * this cap; Graphic Animation has taken it to 596,673 bytes against a 524,288
 * limit — 113.8%. So the named caps no longer bind before the byte total in the
 * worst case, and an author who filled every cap at once would read a byte count
 * rather than the limit they reached. See the animation section below.
 *
 * Media Graphic Items do not contribute to it. A maximal animated Media Graphic
 * Item measures 1,906 bytes against 3,704 for a maximal animated Text Graphic
 * Item, so the worst case is built from text, and adding a cheaper item kind
 * cannot move it — which is why this figure did not change when they landed.
 *
 * Event Data binding moved that figure twice, in opposite directions, and left it
 * slightly lower: a Graphic Input Binding's `fieldId` must now name a field the
 * binding catalog actually defines, so the worst one is the longest real field name
 * rather than 100 arbitrary characters, while a derived Graphic Source Selection
 * gained a `from` naming a sibling key. Net effect is 1,525 bytes less than the
 * animation-inclusive measurement it merged with — 596,673 became 595,148. The cap
 * itself is unchanged: it is not this ticket's to set, and the number above the cap
 * is a measurement of what the caps admit rather than a budget anyone chose.
 *
 * It is deliberately a named cap so an operator reads which limit they reached
 * rather than a byte count. Graphic Group children count towards it — they are
 * Graphic Items and they cost bytes.
 *
 * ## That 79% is a bound, not a forecast
 *
 * Read without its construction the figure suggests the budget is nearly full. It
 * is not. It describes a Screen where all 110 Graphic Items are simultaneously
 * Text Graphic Items carrying a 1,000-character template, a 100-character label,
 * four maximal Graphic Placeholder Styles, a four-stop gradient, an outline and a
 * glow, alongside 60 maximal choice Graphic Inputs — a configuration nobody will
 * author. Realistic authoring measures around 119 KiB, roughly 23% of the budget.
 * The number proves the caps cannot be combined into an oversized write; it does
 * not predict what a Screen will hold.
 *
 * ## Which limit binds first
 *
 * For a realistic large graphics package it is not this cap but
 * `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN`: fifteen lower thirds at four
 * Graphic Inputs each is exactly 60. Anyone finding a package too small to author
 * should move that number before this one.
 *
 * ## Why it is 110 and not more
 *
 * Two open defects gate raising it, and neither is about storage arithmetic:
 *
 * - The whole-`modeConfigs` byte total was an object-level refinement discarded
 *   when the per-mode patch schema is rebuilt from its field schemas, so it was not
 *   enforced on the path the editors write through. That is fixed: the merged
 *   configuration a patch would produce is now validated before it is written, so
 *   the total refuses an oversized write wherever it comes from, and per-field caps
 *   no longer have to carry weight they were never meant to.
 * - Realtime still publishes whole live state and whole mode configs, so a larger
 *   cap would buy storable configuration that cannot be notified — capacity with
 *   no way to reach a client.
 *
 * With both fixed, this cap can be generous, because the worst case is then
 * allowed not to fit: an author who approaches the total gets told which limit
 * they reached and removes something, and every other author never sees it.
 * Until then, reducing is the only direction that does not make the second defect
 * worse. 110 is about fifteen lower thirds plus a slate and a bug, comfortably
 * more than the fidelity prototype's acceptance evidence requires.
 *
 *
 * ## What Graphic Animation adds
 *
 * Every Broadcast Graphic and every Graphic Item may own one Graphic Animation
 * Recipe per lifecycle phase, which is the largest single addition to this
 * arithmetic so far. Measured against this schema's own maxima: animating all four
 * phases with a fade, slide, scale, and reveal channel each costs a Graphic Item
 * 1,039 bytes, and a Broadcast Graphic shell 2,115 — a shell pays more because it
 * also carries a four-phase stagger naming its direct items, and an id costs 102
 * bytes per appearance at the 100-character cap. Across 110 Graphic Items and 50
 * Broadcast Graphic shells that is the whole 183,432-byte rise from 413,241.
 *
 * The cap is deliberately left where Graphic Inputs set it, even though the worst
 * case now exceeds the budget. Animation's cost is recorded rather than used to
 * re-derive a number, because two tickets already cut this same constant
 * independently — each measuring correctly and each blind to the other — and
 * re-deriving it a third time from one vocabulary's own arithmetic would repeat
 * exactly that mistake. A test asserts the overshoot rather than hiding it.
 *
 * Two things make asserting it the right response rather than a deferral. The
 * whole-`modeConfigs` byte total is now enforced on the editors' write path, so the
 * overshoot is refused legibly instead of being written and truncated later; and the
 * shape it would be refused in — an author filling all 110 Graphic Items with
 * maximal templates, four Placeholder Styles, every animation channel on all four
 * phases, plus 60 maximal Graphic Inputs — is not one anyone will author. Realistic
 * authoring is a fraction of the budget. What is lost is the *named cap binds
 * first* property, and restoring it is a cap decision that one owned measurement
 * should make.
 * This comment deliberately states no cross-mode headroom figure. The budget is
 * shared with every other Screen Mode, so what remains is a property of the whole
 * `modeConfigs` map rather than of this cap, and reconstructing it per ticket is
 * how two tickets came to quote different baselines for the same pre-existing
 * Graphic Item. One owned measurement of the merged worst case reports it instead;
 * the figures above describe only this mode's own contribution to it.
 *
 * ## What Graphic Channels add
 *
 * 11,863 bytes, taking 595,148 to 607,011. Membership costs on both sides: 25 maximal
 * channel declarations at about 244 bytes each, and a 100-character `channelId` on
 * every one of the 50 Broadcast Graphic shells. It is by some distance the cheapest
 * capability measured here, and it does not change the conclusion above — the worst
 * case already exceeded the budget, the total is enforced on the write path, and the
 * cap decision remains #99's.
 */
export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN = 110;
export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES = 607_011;

function countGraphicItems(items: readonly { type: string; children?: readonly unknown[] }[]): number {
	return items.reduce(
		(total, item) => total + 1 + (item.type === 'group' ? (item.children?.length ?? 0) : 0),
		0,
	);
}

function graphicItemIds(items: readonly { id: string; type: string; children?: readonly { id: string }[] }[]) {
	return items.flatMap(item => [
		item.id,
		...(item.type === 'group' ? (item.children ?? []).map(child => child.id) : []),
	]);
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
	animation: graphicContainerAnimationSchema.optional(),
	styleSet: graphicStyleSetLinkSchema.optional(),
	styleRefs: graphicContainerStyleRefsSchema.optional(),
}).strict();

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
			MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
			`A Feature Match Layout must not contain more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC} Graphic Items`,
		)
		.refine(
			items => new Set(graphicItemIds(items)).size === graphicItemIds(items).length,
			'Graphic Item ids must be unique within one Feature Match Layout',
		),
	animation: graphicContainerAnimationSchema.optional(),
}).strict();

/**
 * How many external video source areas one Feature Match Layout may frame.
 *
 * Its own cap rather than a share of the Graphic Item budget: a Source Item is a
 * host-owned Definition on its own list, and a broadcast has as many cameras as it
 * has cameras.
 */
export const MAX_FEATURE_MATCH_SOURCE_ITEMS = 20;

/**
 * A Graphic Channel: one optional playout lane, and how it replaces its member.
 *
 * `handoff` is optional because a Graphic Channel defaults to Overlap, and an absent
 * policy is the only way that default stays true of a channel nobody has configured
 * as well as of one whose author chose it.
 */
const graphicChannelConfigSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(100),
	handoff: z.enum(GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES).optional(),
}).strict();

/**
 * Broadcast Graphics mode configuration: the Screen's authored back-to-front
 * stack of Broadcast Graphics, and the Graphic Channels its members join. The
 * Screen's canvas stays in the Screen config.
 */
export const broadcastGraphicsModeConfigSchema = z.object({
	// Every cap lives on the array itself rather than on this object: the
	// mode-configuration patch schema rebuilds each mode from its field schemas,
	// so an object-level refinement would never reach the write path the editor uses.
	graphics: z.array(broadcastGraphicConfigSchema)
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
		),
	channels: z.array(graphicChannelConfigSchema)
		.max(
			MAX_GRAPHIC_CHANNELS_PER_SCREEN,
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_CHANNELS_PER_SCREEN} Graphic Channels`,
		)
		// A Broadcast Graphic joins a channel by id alone, so two channels sharing one id
		// would leave which policy governs the handoff undecided. On the field for the
		// same reason every other uniqueness rule here is.
		.refine(
			channels => new Set(channels.map(channel => channel.id)).size === channels.length,
			'Graphic Channel ids must be unique within one Broadcast Graphics Screen',
		)
		.optional(),
}).strict() satisfies z.ZodType<BroadcastGraphicsModeConfig>;

/**
 * Feature Match Overlay mode configuration.
 *
 * It sits here, after the Shared Graphics Foundation section, because a Feature
 * Match Layout is a Frame, its host-owned Source Items, and one shared item tree —
 * and that tree is the Shared Graphics Foundation vocabulary above.
 *
 * Every cap lives on its own array for the same reason every Broadcast Graphics
 * cap does: the mode-configuration patch schema rebuilds each mode from its field
 * schemas, so an object-level refinement would never reach the write path the
 * editor uses.
 */
/**
 * One Feature Match Layout: the Frame, its host-owned Source Items, and the
 * shared item tree.
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

export const featureMatchOverlayModeConfigSchema = z.object({
	featureMatchId: z.number().int().positive().nullable(),
	presetId: featureMatchOverlayPresetIdSchema,
	layout: featureMatchLayoutConfigSchema,
}).strict() satisfies z.ZodType<FeatureMatchOverlayModeConfig>;

export const metagameModeConfigSchema = z.object({
	viewMode: z.enum(METAGAME_VIEW_MODE_VALUES),
	scope: z.enum(METAGAME_SCOPE_VALUES),
	topN: z.number().int().min(1).max(500),
	playerListId: z.number().int().positive().optional(),
	archetypeFilter: z.string().max(200).optional(),
	sortBy: z.enum(METAGAME_SORT_BY_VALUES),
	cardSortBy: z.enum(METAGAME_CARD_SORT_BY_VALUES),
	archetypeColumns: z.array(metagameArchetypeColumnConfigSchema).min(1).max(10),
	cardColumns: z.array(metagameCardColumnConfigSchema).min(1).max(12),
	limit: z.number().int().min(1).max(500),
	maxTableWidth: z.number().int().min(1).nullable().optional(),
	pageSize: z.number().int().min(1).max(100),
	autoPaging: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),
	currentPage: z.number().int().min(1).optional(),
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),
	animateEntries: z.boolean(),
}).strict();

// Map of mode name to its config schema
export const modeConfigSchemaMap = {
	'idle': idleModeConfigSchema,
	'card': cardModeConfigSchema,
	'deck': deckModeConfigSchema,
	'standings': standingsModeConfigSchema,
	'topCut': topCutModeConfigSchema,
	'feature-match': matchModeConfigSchema,
	'feature-match-overlay': featureMatchOverlayModeConfigSchema,
	'broadcast-graphics': broadcastGraphicsModeConfigSchema,
	'metagame': metagameModeConfigSchema,
	'player-history': playerHistoryModeConfigSchema,
} as const;

export const modeConfigPatchSchemaMap = {
	'idle': createModeConfigPatchSchema(idleModeConfigSchema),
	'card': createModeConfigPatchSchema(cardModeConfigSchema),
	'deck': createModeConfigPatchSchema(deckModeConfigSchema),
	'standings': createModeConfigPatchSchema(standingsModeConfigSchema),
	'topCut': createModeConfigPatchSchema(topCutModeConfigSchema),
	'feature-match': createModeConfigPatchSchema(matchModeConfigSchema),
	'feature-match-overlay': createModeConfigPatchSchema(featureMatchOverlayModeConfigSchema),
	'broadcast-graphics': createModeConfigPatchSchema(broadcastGraphicsModeConfigSchema),
	'metagame': createModeConfigPatchSchema(metagameModeConfigSchema),
	'player-history': createModeConfigPatchSchema(playerHistoryModeConfigSchema),
} as const;

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

// Full modeConfigs map schema (all keys optional)
export const modeConfigsMapSchema = withModeConfigsMapRules(
	z.object(modeConfigSchemaMap).strict().partial(),
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
	const offenders = modeConfigSchemasWithObjectLevelChecks(modeConfigSchemaMap);

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
	})
	.extend({
		slug: screenSlugSchema,
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
	})
	.extend({
		slug: screenSlugSchema.optional(),
		modeConfigs: modeConfigsMapSchema.nullable().optional(),
		screenConfig: boundedScreenConfigSchema.nullable().optional(),
		stateVersion: z.number().int().nonnegative(),
	})
	.strict();

export const screenCommandSchema = z.object({
	command: z.enum(SCREEN_COMMAND_VALUES),
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
	mode: z.enum(SCREEN_MODE_VALUES),
});

/* TYPES */
export type CreateScreenInput = z.infer<typeof createScreenSchema>;
export type ScreenCommandInput = z.infer<typeof screenCommandSchema>;
export type UpdateScreenInput = z.infer<typeof updateScreenSchema>;
export type ScreenParams = z.infer<typeof screenParamsSchema>;
export type ModeConfigParams = z.infer<typeof modeConfigParamsSchema>;
