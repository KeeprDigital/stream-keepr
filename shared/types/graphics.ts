import type { FeatureMatchOverlayFontId } from '../featureMatchOverlayFonts';

/**
 * Shared Graphics Foundation vocabulary.
 *
 * The Graphic Item, geometry, and styling model that Broadcast Graphics and
 * Feature Match Overlay both speak. It now carries the full static vocabulary
 * the compositor interprets: Text Graphic Items, Shape Graphic Items, Graphic
 * Groups, per-corner Shape Geometry with bounded edge slants, Graphic Surface
 * Style with solid and linear-gradient Graphic Fill, outline and glow, Graphic
 * Rotation, and bounded Graphic Animation Recipes. Media Graphic Items and
 * Graphic Inputs join the same vocabulary later without changing this shape.
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

/**
 * The bound on a Text Graphic Item's own text. It holds a name, a title, or a
 * Graphic Text Template with `{inputKey}` placeholders, and its Text Overflow
 * Policy already assumes the rendered result fits authored bounds.
 *
 * It lives here rather than in the wire schema so the editor can bound its own
 * control, and an operator is stopped in the field instead of losing a whole
 * write to a validation error.
 */
export const MAX_GRAPHIC_TEXT_LENGTH = 1000;

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
 * Graphic Animation
 * ──────────────────────────────────────────────── */

/**
 * The lifecycle phases a Graphic Animation Recipe may be authored for. A
 * Graphic Animation owns at most one recipe per phase, which this vocabulary
 * states structurally: the phases are the keys of one record.
 */
export const GRAPHIC_ANIMATION_PHASE_VALUES = ['enter', 'on-screen', 'update', 'exit'] as const;

export type GraphicAnimationPhase = typeof GRAPHIC_ANIMATION_PHASE_VALUES[number];

/** Bounded easing rather than an author-defined curve. */
export const GRAPHIC_ANIMATION_EASING_VALUES = [
	'linear',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'back-in',
	'back-out',
	'back-in-out',
] as const;

export type GraphicAnimationEasing = typeof GRAPHIC_ANIMATION_EASING_VALUES[number];

/**
 * One of nine points that determines the apparent origin of scale motion. It
 * belongs to a scale channel and is independent of the Graphic Anchor Point,
 * which is why it is its own vocabulary rather than a reuse of that one.
 */
export const GRAPHIC_ANIMATION_ORIGIN_VALUES = [
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

export type GraphicAnimationOrigin = typeof GRAPHIC_ANIMATION_ORIGIN_VALUES[number];

/** The eight compass directions a slide channel travels. */
export const GRAPHIC_SLIDE_DIRECTION_VALUES = [
	'north',
	'north-east',
	'east',
	'south-east',
	'south',
	'south-west',
	'west',
	'north-west',
] as const;

export type GraphicSlideDirection = typeof GRAPHIC_SLIDE_DIRECTION_VALUES[number];

/** A fixed canonical pixel offset, or the distance required to clear the owner's parent. */
export const GRAPHIC_SLIDE_DISTANCE_MODE_VALUES = ['fixed', 'clear-parent'] as const;

export type GraphicSlideDistanceMode = typeof GRAPHIC_SLIDE_DISTANCE_MODE_VALUES[number];

/** The edge a reveal channel wipes from, across the owner's rectangular bounds. */
export const GRAPHIC_REVEAL_EDGE_VALUES = ['left', 'right', 'top', 'bottom'] as const;

export type GraphicRevealEdge = typeof GRAPHIC_REVEAL_EDGE_VALUES[number];

/** The order a container walks its direct Graphic Items in while staggering them. */
export const GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES = ['list', 'reverse-list'] as const;

export type GraphicAnimationStaggerOrder = typeof GRAPHIC_ANIMATION_STAGGER_ORDER_VALUES[number];

/**
 * The settled bounds every Graphic Animation Recipe is authored within.
 *
 * They live beside the vocabulary rather than only in the wire schema so the
 * editor bounds its own controls with the same numbers a write is validated
 * against, and an author is stopped in the field instead of losing a whole write.
 */
export const MIN_GRAPHIC_ANIMATION_DURATION_MS = 50;
export const MAX_GRAPHIC_ANIMATION_DURATION_MS = 10_000;
export const MAX_GRAPHIC_ANIMATION_DELAY_MS = 10_000;
export const MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS = 10_000;
export const MAX_GRAPHIC_ANIMATION_PAUSE_MS = 60_000;
export const MIN_GRAPHIC_ANIMATION_REPEAT = 1;
export const MAX_GRAPHIC_ANIMATION_REPEAT = 100;
/** A uniform factor from zero to twice the owner's Graphic Resting State size. */
export const MAX_GRAPHIC_ANIMATION_SCALE = 2;
export const MAX_GRAPHIC_SLIDE_DISTANCE_PX = 10_000;

/** An indefinite on-screen repetition, which never gates the on-air Graphic Playout State. */
export const GRAPHIC_ANIMATION_REPEAT_INDEFINITE = 'indefinite';

/**
 * A zero-to-one reduction from the owner's Graphic Resting State opacity.
 *
 * `opacity` is the excursion end of the channel: the value motion travels from
 * while entering and towards while exiting. Fade channels on a Broadcast
 * Graphic and its Graphic Items compose multiplicatively.
 */
export interface GraphicFadeChannel {
	opacity: number;
}

/**
 * A slide along one of eight compass directions. `distance` is a canonical pixel
 * offset and is ignored while the mode clears the owner's parent, in which case
 * the distance is whatever it takes for the owner to leave that parent's bounds.
 */
export interface GraphicSlideChannel {
	direction: GraphicSlideDirection;
	distanceMode: GraphicSlideDistanceMode;
	distance: number;
}

/** A uniform scale about one Graphic Animation Origin. */
export interface GraphicScaleChannel {
	factor: number;
	origin: GraphicAnimationOrigin;
}

/** A wipe from one edge across the owner's rectangular bounds. */
export interface GraphicRevealChannel {
	edge: GraphicRevealEdge;
}

/**
 * A bounded combination containing at most one fade, slide, scale, and reveal
 * channel. Its channels run simultaneously with shared timing and easing,
 * without an internal sequence or keyframes, and every channel is expressed
 * relative to the owner's Graphic Resting State — which a recipe never changes.
 *
 * `delay` is measured from the one shared start of its lifecycle phase, never
 * from another recipe's completion.
 */
export interface GraphicAnimationRecipe {
	duration: number;
	easing: GraphicAnimationEasing;
	delay: number;
	fade?: GraphicFadeChannel;
	slide?: GraphicSlideChannel;
	scale?: GraphicScaleChannel;
	reveal?: GraphicRevealChannel;
}

/**
 * An on-screen recipe cycles from the Graphic Resting State to its excursion and
 * back without accumulating motion, optionally pausing between cycles, and runs
 * once, a fixed number of times, or until exit is requested.
 */
export interface GraphicOnScreenAnimationRecipe extends GraphicAnimationRecipe {
	pause: number;
	repeat: number | typeof GRAPHIC_ANIMATION_REPEAT_INDEFINITE;
}

/**
 * An ordered stagger of a selected subset of a container's direct Graphic Items.
 *
 * The subset is walked in list or reverse-list order and each selected item's
 * position in that walk multiplies `step` into an offset added to that item's
 * own recipe delay. Items outside the subset keep their own delay unchanged.
 *
 * Ids that no longer name a direct child are ignored rather than rejected: an
 * author who deletes a staggered item must not have their next write refused, so
 * referential integrity is a projection concern, not a validation one.
 */
export interface GraphicAnimationStagger {
	order: GraphicAnimationStaggerOrder;
	step: number;
	itemIds: string[];
}

/**
 * The recipe-based motion owned independently by a Broadcast Graphic or Graphic
 * Item. At most one recipe per lifecycle phase, and no recipes at all until a
 * template author enables them — an absent phase changes its owner immediately.
 */
export interface GraphicAnimation {
	'enter'?: GraphicAnimationRecipe;
	'on-screen'?: GraphicOnScreenAnimationRecipe;
	'update'?: GraphicAnimationRecipe;
	'exit'?: GraphicAnimationRecipe;
}

/**
 * The Graphic Animation of a container — a Broadcast Graphic or a Graphic Group —
 * which may additionally stagger the recipes of its direct Graphic Items. Only a
 * container carries a stagger, because only a container has direct items to order.
 */
export interface GraphicContainerAnimation extends GraphicAnimation {
	stagger?: {
		'enter'?: GraphicAnimationStagger;
		'on-screen'?: GraphicAnimationStagger;
		'update'?: GraphicAnimationStagger;
		'exit'?: GraphicAnimationStagger;
	};
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
	/**
	 * Optional recipe-based motion. Absent means this item changes immediately in
	 * every lifecycle phase, which is what a newly authored item gets.
	 */
	animation?: GraphicAnimation;
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
	/** A Graphic Group coordinates the animation of its direct items as well as its own. */
	animation?: GraphicContainerAnimation;
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
	/**
	 * Whole-graphic motion, which composes with the Graphic Animations of its
	 * Graphic Items and may stagger them.
	 */
	animation?: GraphicContainerAnimation;
}
