import type { FeatureMatchOverlayFontId } from '../featureMatchOverlayFonts';
import type { GraphicFocalPosition, MediaGraphicItemFit } from './graphicItem';
import type { GraphicAssetReference } from './graphicsAsset';

/**
 * Shared Graphics Foundation vocabulary.
 *
 * The Graphic Item, geometry, and styling model that Broadcast Graphics and
 * Feature Match Overlay both speak. It now carries the full static vocabulary
 * the compositor interprets: Text Graphic Items, Media Graphic Items, Shape
 * Graphic Items, Graphic Groups, per-corner Shape Geometry with bounded edge
 * slants, Graphic Surface Style with solid and linear-gradient Graphic Fill,
 * outline and glow, Graphic Rotation, and the typed Graphic Inputs a Text
 * Graphic Item renders through a Graphic Text Template. Graphic Animation joins
 * the same vocabulary later without changing this shape.
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
 * The bound on a Text Graphic Item's own stored text — the Graphic Text Template
 * an author writes, not the string it renders.
 *
 * It lives here rather than in the wire schema so the editor can bound its own
 * control, and an operator is stopped in the field instead of losing a whole
 * write to a validation error.
 *
 * ## The stored bound is not the rendered bound
 *
 * `{inputKey}` placeholders expand at render time, so a template well inside this
 * cap can render a much longer string. Two separate mechanisms bound the result,
 * and neither is this constant:
 *
 * - Every text Graphic Input declares its own `maxLength`, capped by this same
 *   constant. A longer value is unavailable rather than truncated, so it is never
 *   accepted on air and never reaches the compositor.
 * - Whatever length does render, the Text Graphic Item's Text Overflow Policy is
 *   what keeps it inside authored bounds: clip, ellipsis, or shrink to the
 *   author's minimum font size and then ellipsis. That policy has always applied
 *   to the *rendered* string, which is exactly what expansion produces.
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
 * Graphic Inputs
 * ──────────────────────────────────────────────── */

/** The declared type of a Graphic Input. */
export const GRAPHIC_INPUT_TYPE_VALUES = ['text', 'number', 'toggle', 'choice', 'color', 'media'] as const;

export type GraphicInputType = typeof GRAPHIC_INPUT_TYPE_VALUES[number];

/**
 * Whether a Graphic Input change is staged for operator confirmation or applied
 * immediately to an on-air Broadcast Graphic. A newly declared Graphic Input is
 * staged.
 */
export const ON_AIR_UPDATE_POLICY_VALUES = ['staged', 'live'] as const;

export type OnAirUpdatePolicy = typeof ON_AIR_UPDATE_POLICY_VALUES[number];

export const DEFAULT_ON_AIR_UPDATE_POLICY: OnAirUpdatePolicy = 'staged';

/**
 * The grammar of a stable Graphic Input key.
 *
 * One pattern serves the declaration and the Graphic Text Template parser, so a
 * `{placeholder}` can never name something the declaration could not have been
 * called.
 */
export const GRAPHIC_INPUT_KEY_PATTERN = /^[a-z][\w-]*$/i;

export const MAX_GRAPHIC_INPUT_KEY_LENGTH = 40;
export const MAX_GRAPHIC_INPUT_LABEL_LENGTH = 60;

/**
 * How many options a choice Graphic Input may offer, and how long each option's
 * stored value and label may be.
 *
 * A choice input generates one picker in Live Control, so a long list is already
 * the wrong control for an operator working a live show. These bounds are also
 * where a choice input stops dominating the Screen's byte budget: a maximal one is
 * the most expensive declaration there is.
 */
export const MAX_GRAPHIC_INPUT_CHOICE_OPTIONS = 12;
export const MAX_GRAPHIC_INPUT_CHOICE_LENGTH = 40;

/** One selectable option of a choice Graphic Input. */
export interface GraphicInputChoiceOption {
	/** The stored value. Stable, so renaming the label never invalidates a value. */
	value: string;
	/** What an operator reads, and what a Graphic Text Template renders. */
	label: string;
}

interface GraphicInputDeclarationBase {
	/** The stable key a `{inputKey}` placeholder and a Graphic Input Binding name. */
	key: string;
	label: string;
	/** A required Graphic Input must resolve an available value before Take. */
	required: boolean;
	updatePolicy: OnAirUpdatePolicy;
}

/**
 * The bound on an accepted text Graphic Input value.
 *
 * A value longer than its declared `maxLength` is unavailable rather than
 * truncated, so an over-long value never reaches the compositor at all.
 */
export interface TextGraphicInputDeclaration extends GraphicInputDeclarationBase {
	type: 'text';
	default: string;
	maxLength: number;
}

export interface NumberGraphicInputDeclaration extends GraphicInputDeclarationBase {
	type: 'number';
	default: number | null;
	min?: number;
	max?: number;
	integer: boolean;
}

export interface ToggleGraphicInputDeclaration extends GraphicInputDeclarationBase {
	type: 'toggle';
	default: boolean;
}

export interface ChoiceGraphicInputDeclaration extends GraphicInputDeclarationBase {
	type: 'choice';
	default: string | null;
	options: GraphicInputChoiceOption[];
}

export interface ColorGraphicInputDeclaration extends GraphicInputDeclarationBase {
	type: 'color';
	default: string | null;
}

/**
 * A media Graphic Input names a Graphics Asset Library revision rather than a
 * URL, exactly as an authored asset reference does. Which Graphic Items can
 * render one is the Media Graphic Item's business, not this declaration's.
 */
export interface MediaGraphicInputDeclaration extends GraphicInputDeclarationBase {
	type: 'media';
	default: GraphicAssetReference | null;
	mediaKind: GraphicMediaKind;
}

export type GraphicInputDeclaration
	= | TextGraphicInputDeclaration
		| NumberGraphicInputDeclaration
		| ToggleGraphicInputDeclaration
		| ChoiceGraphicInputDeclaration
		| ColorGraphicInputDeclaration
		| MediaGraphicInputDeclaration;

/**
 * One Graphic Input's value, in the shape its declared type takes.
 *
 * A value that violates its declared type or constraints is still storable: it
 * is reported unavailable rather than coerced, clamped, truncated, or
 * substituted, which means Live Control can show the operator exactly what they
 * entered and why it cannot go on air.
 */
export type GraphicInputValue = string | number | boolean | GraphicAssetReference | null;

/**
 * The media a Media Graphic Item can render, and therefore what a media Graphic
 * Input may resolve to. Named rather than inlined because the Media Graphic Item
 * vocabulary needs the identical set.
 */
export const GRAPHIC_MEDIA_KIND_VALUES = ['image', 'silent-video'] as const;

export type GraphicMediaKind = typeof GRAPHIC_MEDIA_KIND_VALUES[number];

/** The single-entity Event Data kinds a Graphic Source Selection may select. */
export const GRAPHIC_SOURCE_SELECTION_KIND_VALUES = [
	'event',
	'player',
	'talent',
	'phase',
	'round',
	'match',
	'feature-match-slot',
	'archetype',
] as const;

export type GraphicSourceSelectionKind = typeof GRAPHIC_SOURCE_SELECTION_KIND_VALUES[number];

/**
 * The fixed relationships one Graphic Source Selection may follow from another.
 *
 * A Graphic Source Selection resolves the current Event, an operator selection, or
 * a fixed relationship from another selection — and this is the closed set of those
 * relationships. It is deliberately a named vocabulary rather than a path
 * expression: an operator picks a Match once and the two Players either side of it
 * resolve, without anyone authoring a query.
 */
export const GRAPHIC_SOURCE_RELATION_VALUES = [
	'player1',
	'player2',
	'match',
	'round',
	'phase',
	'archetype',
	'commentator1',
	'commentator2',
] as const;

export type GraphicSourceRelation = typeof GRAPHIC_SOURCE_RELATION_VALUES[number];

/** One Graphic Source Selection derived from another rather than picked. */
export interface GraphicSourceDerivation {
	/** The Graphic Source Selection this one follows. */
	sourceKey: string;
	relation: GraphicSourceRelation;
}

/**
 * A named, single-entity Event Data selection owned by a placed Broadcast Graphic.
 *
 * `from` is what makes it not a collection query in the one place that would be
 * tempting: a Player either side of a Match is reached by a fixed relationship
 * from the Match the operator already picked, and resolves from that Match's
 * production snapshot rather than from current Event Data.
 */
export interface GraphicSourceSelectionDeclaration {
	key: string;
	label: string;
	kind: GraphicSourceSelectionKind;
	from?: GraphicSourceDerivation;
}

/**
 * An Event-specific, type-compatible mapping from a Graphic Input to one
 * broadcast-facing field on a Graphic Source Selection.
 *
 * The shape is declared here so Live Control can distinguish a bound input from
 * a manual one. Resolving `fieldId` against the curated field catalogue and
 * current Event Data is not yet implemented, so a bound input currently has no
 * latest bound value.
 */
export interface GraphicInputBinding {
	inputKey: string;
	sourceKey: string;
	fieldId: string;
}

/**
 * An optional typography-only override for one `{inputKey}` placeholder of a
 * Text Graphic Item.
 *
 * Line height and text alignment are deliberately absent: they lay out the
 * item's whole text block rather than one run inside it, so they stay with the
 * item's base typography. Literal text always uses that base typography, and a
 * placeholder style adds no fills, outlines, or other surface styling.
 */
export type GraphicPlaceholderStyle = Partial<Pick<
	GraphicTypography,
	'fontId' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'textTransform' | 'letterSpacing' | 'color'
>>;

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
	/**
	 * A Graphic Text Template: literal text combined with `{inputKey}`
	 * placeholders for this Broadcast Graphic's Graphic Inputs. A string with no
	 * placeholder is simply literal text.
	 */
	text: string;
	typography: GraphicTypography;
	overflowPolicy: TextOverflowPolicy;
	/** The author-set floor a `shrink` Text Overflow Policy shrinks to before ellipsis. */
	minFontSize: number;
	/**
	 * Graphic Placeholder Styles, keyed by the `{inputKey}` each one styles. A key
	 * the template does not reference styles nothing.
	 */
	placeholderStyles?: Record<string, GraphicPlaceholderStyle>;
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

/**
 * The bounds on a Media Graphic Item's silent-video playback rate. They live here
 * rather than only in the wire schema so the editor bounds its own control and an
 * author is stopped in the field instead of losing a whole write.
 */
export const MIN_GRAPHIC_MEDIA_PLAYBACK_RATE = 0.25;
export const MAX_GRAPHIC_MEDIA_PLAYBACK_RATE = 4;

/**
 * A Graphic Item that renders one image or silent video Graphic Asset inside its
 * authored bounds.
 *
 * Fitting, focal position, and opacity are the whole presentation vocabulary; a
 * Media Graphic Item carries no Graphic Surface Style, because fill, outline, and
 * glow belong to the kinds that paint a surface rather than to one that paints an
 * asset. Clipping is an ordinary Shape Geometry — the canonical one from this
 * file — so a media item clips to exactly the shapes a Shape Graphic Item draws.
 *
 * `playbackRate` and `loop` are video-only. An image item stores them and ignores
 * them, which keeps switching an item between an image and a silent video from
 * discarding the playback the author already set up.
 */
export interface MediaGraphicItemConfig extends GraphicItemConfigBase {
	type: 'media';
	/**
	 * One exact Graphic Asset identity and revision. Absent is an unfilled item:
	 * it occupies its bounds and paints nothing, so an author can place and
	 * position it before choosing content.
	 */
	asset?: GraphicAssetReference;
	mediaKind: GraphicMediaKind;
	fit: MediaGraphicItemFit;
	focalPosition: GraphicFocalPosition;
	opacity: number;
	/**
	 * Absent clips to the item's own rectangle, which its bounds already do.
	 * Present clips to this Shape Geometry instead.
	 */
	clipGeometry?: ShapeGeometry;
	/**
	 * The pinned revision's own target compatibility, recorded when the asset is
	 * selected. The Graphics Asset Library's reference index checks a silent-video
	 * reference against it, and no pure render model can ask the library, so the
	 * fact travels with the reference that depends on it.
	 */
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	playbackRate: number;
	loop: boolean;
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
export type GraphicGroupChildConfig
	= TextGraphicItemConfig | ShapeGraphicItemConfig | MediaGraphicItemConfig;

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

export type GraphicItemConfig
	= TextGraphicItemConfig | ShapeGraphicItemConfig | MediaGraphicItemConfig | GraphicGroupItemConfig;

export type GraphicItemKind = GraphicItemConfig['type'];

/** An authored visual composition shown, hidden, and controlled as one unit. */
export interface BroadcastGraphicConfig {
	id: string;
	name: string;
	/** Graphic Layer Order: the back-to-front list order of this graphic's direct Graphic Items. */
	items: GraphicItemConfig[];
	/**
	 * The typed Graphic Inputs this Broadcast Graphic declares. Absent declares
	 * none, so a graphic that exposes no operator values carries no key at all.
	 */
	inputs?: GraphicInputDeclaration[];
	/** The single-entity Event Data selections this placed graphic's bindings read. */
	sources?: GraphicSourceSelectionDeclaration[];
	/** Graphic Input Bindings, at most one per Graphic Input. */
	bindings?: GraphicInputBinding[];
}
