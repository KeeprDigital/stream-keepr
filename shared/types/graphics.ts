import type { FeatureMatchOverlayFontId } from '../featureMatchOverlayFonts';

/**
 * Shared Graphics Foundation vocabulary.
 *
 * The Graphic Item, geometry, and styling model that Broadcast Graphics and
 * Feature Match Overlay both speak. This module carries only the minimal
 * vocabulary the compositor interprets today — Text Graphic Items and Shape
 * Graphic Items. Graphic Groups, per-corner Shape Geometry and edge slants,
 * gradients, glow, Graphic Rotation, Media Graphic Items, and Graphic
 * Animation join the same vocabulary later without changing this shape.
 */

/** One of nine points on a canvas-positioned Graphic Item. */
export const GRAPHIC_ANCHOR_POINT_VALUES = [
	'top-left',
	'top',
	'top-right',
	'left',
	'center',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right',
] as const;

export type GraphicAnchorPoint = typeof GRAPHIC_ANCHOR_POINT_VALUES[number];

/** The bounded behaviour when rendered text exceeds a Text Graphic Item's authored bounds. */
export const TEXT_OVERFLOW_POLICY_VALUES = ['clip', 'ellipsis', 'shrink'] as const;

export type TextOverflowPolicy = typeof TEXT_OVERFLOW_POLICY_VALUES[number];

/**
 * The operator-visible lifecycle status of a placed Broadcast Graphic.
 *
 * The whole vocabulary is declared here because it is settled, but playout
 * currently produces only off and on-air. Waiting belongs to an Out-then-in
 * Graphic Channel handoff, and entering, updating, and exiting are the phases of
 * a Graphic Animation, so each becomes reachable with the capability that
 * creates it.
 */
export const GRAPHIC_PLAYOUT_STATE_VALUES = [
	'off',
	'waiting',
	'entering',
	'on-air',
	'updating',
	'exiting',
] as const;

export type GraphicPlayoutState = typeof GRAPHIC_PLAYOUT_STATE_VALUES[number];

/** An authoring projection of canonical pixel geometry. Storage is always pixels. */
export const GRAPHIC_GEOMETRY_UNIT_VALUES = ['px', 'percent', 'grid'] as const;

export type GraphicGeometryUnit = typeof GRAPHIC_GEOMETRY_UNIT_VALUES[number];

/** The application font registry shared by every graphics host. */
export type GraphicFontId = FeatureMatchOverlayFontId;

export const GRAPHIC_TEXT_TRANSFORM_VALUES = ['none', 'uppercase', 'lowercase', 'capitalize'] as const;
export type GraphicTextTransform = typeof GRAPHIC_TEXT_TRANSFORM_VALUES[number];

export const GRAPHIC_TEXT_ALIGN_VALUES = ['left', 'center', 'right'] as const;
export type GraphicTextAlign = typeof GRAPHIC_TEXT_ALIGN_VALUES[number];

export const GRAPHIC_FONT_STYLE_VALUES = ['normal', 'italic'] as const;
export type GraphicFontStyle = typeof GRAPHIC_FONT_STYLE_VALUES[number];

/** Stored geometry is always a top-left rectangle in canvas pixels. */
export interface GraphicRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A Text Graphic Item's base typography. */
export interface GraphicTypography {
	fontId: GraphicFontId;
	fontSize: number;
	fontWeight: number;
	fontStyle: GraphicFontStyle;
	textTransform: GraphicTextTransform;
	letterSpacing: number;
	lineHeight: number;
	textAlign: GraphicTextAlign;
	color: string;
}

/**
 * The shared visual treatment of a Shape Graphic Item.
 *
 * The vocabulary offers this to Text Graphic Items and Graphic Groups too, but a
 * Text Graphic Item does not carry one yet: its colour lives in its base
 * typography, and giving text a fill, outline, and glow belongs with the full
 * style vocabulary. Gradients, outlines, and glow join this shape there.
 */
export interface GraphicSurfaceStyle {
	fill: string;
	fillOpacity: number;
}

/**
 * A parameterised rectangle. Per-corner square/rounded/cut treatment and
 * bounded edge slants extend this shape with the full geometry vocabulary; a
 * basic Shape Graphic Item authors one uniform corner radius.
 */
export interface ShapeGeometry {
	cornerRadius: number;
}

interface GraphicItemConfigBase extends GraphicRect {
	id: string;
	label: string;
	visible: boolean;
	/** Determines the item's displayed position; stored geometry stays a top-left rectangle. */
	anchor: GraphicAnchorPoint;
}

export interface TextGraphicItemConfig extends GraphicItemConfigBase {
	type: 'text';
	/** Literal text. Graphic Text Template placeholders arrive with Graphic Inputs. */
	text: string;
	typography: GraphicTypography;
	overflowPolicy: TextOverflowPolicy;
	/** The author-set floor a `shrink` Text Overflow Policy shrinks to before ellipsis. */
	minFontSize: number;
}

export interface ShapeGraphicItemConfig extends GraphicItemConfigBase {
	type: 'shape';
	geometry: ShapeGeometry;
	surfaceStyle: GraphicSurfaceStyle;
}

export type GraphicItemConfig = TextGraphicItemConfig | ShapeGraphicItemConfig;

export type GraphicItemKind = GraphicItemConfig['type'];

/** An authored visual composition shown, hidden, and controlled as one unit. */
export interface BroadcastGraphicConfig {
	id: string;
	name: string;
	/** Graphic Layer Order: the back-to-front list order of this graphic's direct Graphic Items. */
	items: GraphicItemConfig[];
}
