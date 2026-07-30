import type { FeatureMatchOverlayFontId } from '../featureMatchOverlayFonts';

/**
 * Shared Graphics Foundation vocabulary.
 *
 * The Graphic Item, geometry, and styling model that Broadcast Graphics and
 * Feature Match Overlay both speak. It now carries the full static vocabulary
 * the compositor interprets: Text Graphic Items, Shape Graphic Items, Graphic
 * Groups, per-corner Shape Geometry with bounded edge slants, Graphic Surface
 * Style with solid and linear-gradient Graphic Fill, outline and glow, and
 * Graphic Rotation. Media Graphic Items, Graphic Inputs, and Graphic Animation
 * join the same vocabulary later without changing this shape.
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

/* ────────────────────────────────────────────────
 * Graphic Fill and Graphic Surface Style
 * ──────────────────────────────────────────────── */

export const GRAPHIC_FILL_KIND_VALUES = ['solid', 'linear-gradient'] as const;
export type GraphicFillKind = typeof GRAPHIC_FILL_KIND_VALUES[number];

/** One positioned colour stop of a linear-gradient Graphic Fill. */
export interface GraphicFillStop {
	color: string;
	/** Fraction along the gradient axis, 0 to 1. */
	position: number;
	opacity: number;
}

export const MIN_GRAPHIC_FILL_STOPS = 2;
export const MAX_GRAPHIC_FILL_STOPS = 4;

/**
 * A solid colour or a declarative linear gradient with an angle and two to four
 * positioned colour stops. Complex or procedural surfaces are Media Graphic
 * Items rather than Graphic Fills.
 */
export type GraphicFill
	=	| { type: 'solid'; color: string }
		| { type: 'linear-gradient'; angle: number; stops: GraphicFillStop[] };

/** A uniform outline drawn inside a surface's own Shape Geometry. */
export interface GraphicOutline {
	color: string;
	width: number;
}

/** A soft halo around a surface's painted alpha. */
export interface GraphicGlow {
	color: string;
	size: number;
	opacity: number;
}

/**
 * The shared visual treatment available to Text Graphic Items, Shape Graphic
 * Items, and Graphic Groups: fill, fill opacity, a uniform outline around the
 * Shape Geometry, and glow.
 *
 * Typography belongs to the Text Graphic Item and corners and slants belong to
 * Shape Geometry. An independently styled edge is a Shape Graphic Item created
 * from the rule preset rather than one side of an outline.
 */
export interface GraphicSurfaceStyle {
	fill: GraphicFill;
	fillOpacity: number;
	outline?: GraphicOutline;
	glow?: GraphicGlow;
}

/* ────────────────────────────────────────────────
 * Shape Geometry
 * ──────────────────────────────────────────────── */

export const SHAPE_CORNER_TREATMENT_VALUES = ['square', 'rounded', 'cut'] as const;
export type ShapeCornerTreatment = typeof SHAPE_CORNER_TREATMENT_VALUES[number];

/** One independently configured corner. `size` is ignored while square. */
export interface ShapeCorner {
	treatment: ShapeCornerTreatment;
	size: number;
}

export const SHAPE_CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
export type ShapeCornerKey = typeof SHAPE_CORNER_KEYS[number];

/**
 * A parameterised rectangle with independently configurable square, rounded, or
 * cut corners and bounded left or right edge slants.
 *
 * A slant is a signed horizontal offset in canvas pixels: positive insets that
 * edge's top vertex, negative insets its bottom vertex. Rectangle, rule,
 * slanted-edge, and corner-cut presets are authoring shortcuts that initialise
 * this same shape rather than distinct persisted types.
 */
export interface ShapeGeometry {
	topLeft: ShapeCorner;
	topRight: ShapeCorner;
	bottomRight: ShapeCorner;
	bottomLeft: ShapeCorner;
	leftSlant: number;
	rightSlant: number;
}

/* ────────────────────────────────────────────────
 * Graphic Items
 * ──────────────────────────────────────────────── */

/** Weighted-fill or fixed main-axis sizing for a row or column Graphic Group child. */
export interface GraphicGroupChildSizing {
	mode: 'fixed' | 'fill';
	/** Main-axis pixels while fixed. */
	size: number;
	/** Share of the remaining main axis while filling. */
	weight: number;
}

interface GraphicItemConfigBase extends GraphicRect {
	id: string;
	label: string;
	visible: boolean;
	/** Determines the item's displayed position; stored geometry stays a top-left rectangle. */
	anchor: GraphicAnchorPoint;
	/**
	 * Graphic Rotation in degrees around the Graphic Anchor Point. Only
	 * canvas-positioned items rotate; a row or column Graphic Group child ignores it.
	 */
	rotation?: number;
	/**
	 * Main-axis sizing inside a row or column Graphic Group. Only a Graphic Group
	 * child carries one, and only its group's arrangement reads it.
	 */
	sizing?: GraphicGroupChildSizing;
}

export interface TextGraphicItemConfig extends GraphicItemConfigBase {
	type: 'text';
	/** Literal text. Graphic Text Template placeholders arrive with Graphic Inputs. */
	text: string;
	typography: GraphicTypography;
	overflowPolicy: TextOverflowPolicy;
	/** The author-set floor a `shrink` Text Overflow Policy shrinks to before ellipsis. */
	minFontSize: number;
	/**
	 * Absent means the item paints no surface of its own, and inherits its Graphic
	 * Group's local style default when it has one.
	 */
	surfaceStyle?: GraphicSurfaceStyle;
}

export interface ShapeGraphicItemConfig extends GraphicItemConfigBase {
	type: 'shape';
	geometry: ShapeGeometry;
	/** Absent inherits the containing Graphic Group's local style default. */
	surfaceStyle?: GraphicSurfaceStyle;
}

export const GRAPHIC_GROUP_ARRANGEMENT_VALUES = ['row', 'column', 'canvas'] as const;
export type GraphicGroupArrangement = typeof GRAPHIC_GROUP_ARRANGEMENT_VALUES[number];

export const GRAPHIC_GROUP_ALIGN_VALUES = ['start', 'center', 'end', 'stretch'] as const;
export type GraphicGroupAlign = typeof GRAPHIC_GROUP_ALIGN_VALUES[number];

export const GRAPHIC_GROUP_JUSTIFY_VALUES = ['start', 'center', 'end', 'space-between'] as const;
export type GraphicGroupJustify = typeof GRAPHIC_GROUP_JUSTIFY_VALUES[number];

/**
 * A Graphic Group child. Groups are not nested in the initial Shared Graphics
 * Foundation vocabulary, which this union states structurally: no Graphic Group
 * can appear in another group's children.
 */
export type GraphicGroupChildConfig = TextGraphicItemConfig | ShapeGraphicItemConfig;

/**
 * A structural Graphic Item that arranges its direct children as a row, column,
 * or canvas. It forms one layer among its siblings, and its children cannot
 * escape that stacking context.
 */
export interface GraphicGroupItemConfig extends GraphicItemConfigBase {
	type: 'group';
	arrangement: GraphicGroupArrangement;
	/** Inset from the group's own bounds, in canvas pixels. */
	padding: number;
	/** Row and column spacing between children, in canvas pixels. */
	gap: number;
	align: GraphicGroupAlign;
	justify: GraphicGroupJustify;
	/** Clip children to the group's Shape Geometry. */
	clip: boolean;
	/** The group's own surface shape and, while clipping, its clipping boundary. */
	geometry: ShapeGeometry;
	surfaceStyle?: GraphicSurfaceStyle;
	/** A local style default each direct child can override with its own. */
	defaultChildSurfaceStyle?: GraphicSurfaceStyle;
	/** Graphic Layer Order of this group's direct children. */
	children: GraphicGroupChildConfig[];
}

export type GraphicItemConfig = TextGraphicItemConfig | ShapeGraphicItemConfig | GraphicGroupItemConfig;

export type GraphicItemKind = GraphicItemConfig['type'];

/** An authored visual composition shown, hidden, and controlled as one unit. */
export interface BroadcastGraphicConfig {
	id: string;
	name: string;
	/** Graphic Layer Order: the back-to-front list order of this graphic's direct Graphic Items. */
	items: GraphicItemConfig[];
}
