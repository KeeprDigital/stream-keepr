import type { BroadcastGraphicsModeConfig, FeatureMatchOverlayModeConfig, IdleModeConfig } from '~~/shared/types/screenConfig';
import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { SCREEN_MODE_VALUES, screens } from '~~/server/db/schema';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import {
	featureMatchGraphicItemDefinition,
	featureMatchGraphicItemSchemas,
} from '~~/shared/featureMatchGraphicItemDefinitions';
import { GRAPHIC_FONT_IDS } from '~~/shared/modules/graphics';
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
	MEDIA_GRAPHIC_ITEM_KIND_VALUES,
	MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES,
} from '~~/shared/types/graphicItem';
import {
	GRAPHIC_ANCHOR_POINT_VALUES,
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_GROUP_ALIGN_VALUES,
	GRAPHIC_GROUP_ARRANGEMENT_VALUES,
	GRAPHIC_GROUP_JUSTIFY_VALUES,
	GRAPHIC_TEXT_ALIGN_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_FILL_STOPS,
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MAX_GRAPHIC_TEXT_LENGTH,
	MIN_GRAPHIC_FILL_STOPS,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
	SHAPE_CORNER_TREATMENT_VALUES,
	TEXT_OVERFLOW_POLICY_VALUES,
} from '~~/shared/types/graphics';
import {
	FEATURE_MATCH_OVERLAY_ANCHOR_VALUES,
	normalizeFeatureMatchLayout,
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
const featureMatchOverlayFrameAnimationEffectSchema = z.enum(['cells', 'dots', 'fog', 'globe', 'halo', 'net', 'rings', 'ripple', 'waves']);
const featureMatchOverlayPlayerLifeAnimationSchema = z.enum(['none', 'fade', 'pop', 'slide', 'glow']);
const featureMatchGameWinsDisplayModeSchema = z.enum(['boxes', 'number']);
const featureMatchGameWinsBoxOrientationSchema = z.enum(['horizontal', 'vertical']);

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

const featureMatchOverlayBoxStyleSchema = featureMatchOverlayBorderSidesSchema.extend({
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
	padding: nonNegativePixelSchema.optional(),
	textColor: optionalCssColorSchema,
	fontSize: finiteNumberSchema.positive().max(300).optional(),
	font: z.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('application'),
			fontId: z.enum([
				'saira-condensed',
				'ibm-plex-sans',
				'inter',
				'inconsolata',
				'mplantin',
				'system-sans',
				'system-serif',
				'system-mono',
			]),
		}).strict(),
		z.object({
			kind: z.literal('asset'),
			reference: graphicAssetReferenceSchema,
		}).strict(),
	]).optional(),
	fontWeight: z.union([finiteNumberSchema.min(1).max(1000), z.string().min(1).max(50)]).optional(),
	fontStyle: z.enum(['normal', 'italic']).optional(),
	textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
	letterSpacing: finiteNumberSchema.min(-20).max(100).optional(),
	lineHeight: finiteNumberSchema.positive().max(10).optional(),
	textAlign: z.enum(['left', 'center', 'right']).optional(),
	overflow: z.enum(['clip', 'ellipsis', 'shrink', 'visible']).optional(),
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

const featureMatchOverlayTokenStyleMapSchema = z
	.record(z.string().min(1).max(50), featureMatchOverlayBoxStyleSchema)
	.refine(value => Object.keys(value).length <= 100, 'Too many token style entries');

const shapeGeometryCornerSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('square') }).strict(),
	z.object({
		kind: z.literal('rounded'),
		size: nonNegativePixelSchema,
	}).strict(),
	z.object({
		kind: z.literal('cut'),
		size: nonNegativePixelSchema,
	}).strict(),
]);

const shapeGeometrySchema = z.object({
	topLeft: shapeGeometryCornerSchema,
	topRight: shapeGeometryCornerSchema,
	bottomRight: shapeGeometryCornerSchema,
	bottomLeft: shapeGeometryCornerSchema,
	leftEdgeSlant: nonNegativePixelSchema.optional(),
	rightEdgeSlant: nonNegativePixelSchema.optional(),
}).strict();

const featureMatchGraphicGroupStackChildLayoutSchema = z.object({
	mode: z.literal('stack'),
	sizing: z.object({
		mode: z.enum(['fixed', 'content', 'fill']),
		size: finiteNumberSchema.positive().max(10000).optional(),
		weight: finiteNumberSchema.positive().max(100).optional(),
		min: finiteNumberSchema.nonnegative().max(10000).optional(),
		max: finiteNumberSchema.positive().max(10000).optional(),
	}).strict(),
	offsetX: finiteNumberSchema.min(-10000).max(10000).optional(),
	offsetY: finiteNumberSchema.min(-10000).max(10000).optional(),
	alignSelf: z.enum(['start', 'center', 'end', 'stretch']).optional(),
}).strict();

const featureMatchGraphicGroupCanvasChildLayoutSchema = featureMatchOverlayRectSchema.extend({
	mode: z.literal('canvas'),
	anchor: featureMatchOverlayAnchorValueSchema.optional(),
}).strict();

const featureMatchGraphicGroupChildLayoutSchema = z.discriminatedUnion('mode', [
	featureMatchGraphicGroupStackChildLayoutSchema,
	featureMatchGraphicGroupCanvasChildLayoutSchema,
]);

/**
 * Every Graphic Item configuration schema is owned by its Graphic Item
 * Definition. This layer only supplies the shared primitive vocabulary the
 * Definitions compose from, plus the lazily resolved Definition unions.
 */
function featureMatchDefinitionSchemaDependencies() {
	return {
		z,
		playerSide: z.enum(PLAYER_SIDE_VALUES),
		optionalCssColor: optionalCssColorSchema,
		finiteNumber: finiteNumberSchema,
		tokenStyleMap: featureMatchOverlayTokenStyleMapSchema,
		lifeAnimation: featureMatchOverlayPlayerLifeAnimationSchema,
		gameWinsDisplayMode: featureMatchGameWinsDisplayModeSchema,
		gameWinsBoxOrientation: featureMatchGameWinsBoxOrientationSchema,
		opacity: opacitySchema,
		nonNegativePixel: nonNegativePixelSchema,
		boxStyle: featureMatchOverlayBoxStyleSchema,
		graphicAssetReference: graphicAssetReferenceSchema,
		shapeGeometry: shapeGeometrySchema,
		groupChildLayout: featureMatchGraphicGroupChildLayoutSchema,
		// Lazy thunks: both schemas are hoisted consts that exist before any
		// Definition schema is parsed, breaking the construction cycle.
		// eslint-disable-next-line ts/no-use-before-define
		graphicItemConfig: () => featureMatchGraphicItemDefinitionConfigSchema,
		// eslint-disable-next-line ts/no-use-before-define
		media: () => registeredFeatureMatchMediaGraphicItemContentConfigSchema,
	};
}

const featureMatchGraphicItemSchemasFromDefinitions = featureMatchGraphicItemSchemas(
	featureMatchDefinitionSchemaDependencies(),
);

const featureMatchGraphicItemDefinitionConfigSchema = z.union(
	featureMatchGraphicItemSchemasFromDefinitions,
);

const featureMatchLayoutItemBaseSchema = featureMatchOverlayRectSchema.extend({
	id: z.string().min(1).max(100),
	label: z.string().min(1).max(100),
	visible: z.boolean(),
	anchor: featureMatchOverlayAnchorValueSchema.optional(),
}).strict();

const registeredFeatureMatchSourceItemContentConfigSchema
	= featureMatchGraphicItemDefinition('source')
		.schema(featureMatchDefinitionSchemaDependencies()) as unknown as z.ZodObject;
const registeredFeatureMatchMediaGraphicItemContentConfigSchema
	= featureMatchGraphicItemDefinition('media')
		.schema(featureMatchDefinitionSchemaDependencies()) as unknown as z.ZodObject;
const registeredFeatureMatchGraphicGroupContentConfigSchema
	= featureMatchGraphicItemDefinition('graphic-group')
		.schema(featureMatchDefinitionSchemaDependencies()) as unknown as z.ZodObject;

const featureMatchSourceItemConfigSchema = featureMatchLayoutItemBaseSchema.extend(
	registeredFeatureMatchSourceItemContentConfigSchema.shape,
).strict();

const featureMatchMediaGraphicItemConfigSchema = featureMatchLayoutItemBaseSchema.extend(
	registeredFeatureMatchMediaGraphicItemContentConfigSchema.shape,
).strict();

const featureMatchSpecificGraphicItemConfigSchema = featureMatchLayoutItemBaseSchema.extend({
	type: z.literal('graphic-item'),
	graphicItem: featureMatchGraphicItemDefinitionConfigSchema,
	surfaceStyle: featureMatchOverlayBoxStyleSchema.optional(),
}).strict();

const featureMatchGraphicGroupItemConfigSchema = featureMatchLayoutItemBaseSchema.extend(
	registeredFeatureMatchGraphicGroupContentConfigSchema.shape,
).strict();

const featureMatchLayoutItemConfigSchema = z.discriminatedUnion('type', [
	featureMatchSourceItemConfigSchema,
	featureMatchMediaGraphicItemConfigSchema,
	featureMatchSpecificGraphicItemConfigSchema,
	featureMatchGraphicGroupItemConfigSchema,
]) as unknown as z.ZodType<FeatureMatchLayoutItemConfig>;

export const featureMatchOverlayModeConfigSchema = z.object({
	featureMatchId: z.number().int().positive().nullable(),
	presetId: featureMatchOverlayPresetIdSchema,
	layout: z.preprocess(
		(value) => {
			if (
				typeof value !== 'object'
				|| value === null
				|| !Array.isArray((value as { items?: unknown }).items)
			) {
				return value;
			}
			try {
				return normalizeFeatureMatchLayout(value as FeatureMatchOverlayModeConfig['layout']);
			}
			catch {
				// Keep unsupported future-version input intact so the strict
				// version literals below report an ordinary atomic parse failure.
				return value;
			}
		},
		z.object({
			frame: featureMatchOverlayFrameConfigSchema,
			items: z.array(featureMatchLayoutItemConfigSchema).min(1).max(100),
		}).strict(),
	),
}).strict() satisfies z.ZodType<FeatureMatchOverlayModeConfig>;

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
};

const textGraphicItemShape = {
	...graphicItemBaseShape,
	type: z.literal('text'),
	text: z.string().max(MAX_GRAPHIC_TEXT_LENGTH),
	typography: graphicTypographySchema,
	overflowPolicy: z.enum(TEXT_OVERFLOW_POLICY_VALUES),
	minFontSize: finiteNumberSchema.positive().max(600),
	surfaceStyle: graphicSurfaceStyleSchema.optional(),
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
	mediaKind: z.enum(MEDIA_GRAPHIC_ITEM_KIND_VALUES),
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

const textGraphicItemConfigSchema = z.object(textGraphicItemShape).strict();
const shapeGraphicItemConfigSchema = z.object(shapeGraphicItemShape).strict();
const mediaGraphicItemConfigSchema = z.object(mediaGraphicItemShape).strict();

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
]);

export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC = 100;
export const MAX_BROADCAST_GRAPHICS_PER_SCREEN = 50;

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
 * This cap binds the product: 200 x 2,004 + 50 x 166 is about 400 KiB, or 78% of
 * that budget, and realistic authoring measures around 119 KiB. It is
 * deliberately a named cap so an operator reads which limit they reached rather
 * than a byte count. Graphic Group children count towards it — they are Graphic
 * Items and they cost bytes.
 *
 * The remaining ~112 KiB is shared with every other mode's configuration, so a
 * Screen carrying both a maximal Broadcast Graphics stack and a maximal Feature
 * Match Overlay layout can still reach the byte limit. That is a property of one
 * budget shared across modes and predates this cap.
 */
export const MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN = 200;

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

const broadcastGraphicConfigSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(100),
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
}).strict();

/**
 * Broadcast Graphics mode configuration: the Screen's authored back-to-front
 * stack of Broadcast Graphics. The Screen's canvas stays in the Screen config.
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
		),
}).strict() satisfies z.ZodType<BroadcastGraphicsModeConfig>;

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

// Full modeConfigs map schema (all keys optional)
export const modeConfigsMapSchema = z
	.object(modeConfigSchemaMap)
	.strict()
	.partial()
	.refine(
		value => jsonByteLength(value) <= MAX_MODE_CONFIGS_BYTES,
		`Mode configuration must not exceed ${MAX_MODE_CONFIGS_BYTES} bytes`,
	);

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
