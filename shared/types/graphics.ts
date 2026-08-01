import type { GraphicApplicationFontId } from '../modules/graphics/typography';
import type { PlayerSide } from './enums';
import type { GraphicFocalPosition, MediaGraphicItemFit } from './graphicItem';
import type { GraphicAssetReference } from './graphicsAsset';
import type { GraphicContainerStyleRefs, GraphicStyleRefs, GraphicStyleSetLink } from './graphicStyleSet';

/**
 * Shared Graphics Foundation vocabulary.
 *
 * The Graphic Item, geometry, and styling model that Broadcast Graphics and
 * Feature Match Overlay both speak. It now carries the full static vocabulary
 * the compositor interprets: Text Graphic Items, Media Graphic Items, Shape
 * Graphic Items, Graphic Groups, per-corner Shape Geometry with bounded edge
 * slants, Graphic Surface Style with solid and linear-gradient Graphic Fill,
 * outline and glow, Graphic Rotation, bounded Graphic Animation Recipes, and the
 * typed Graphic Inputs a Text Graphic Item renders through a Graphic Text
 * Template.
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
 * Waiting means the graphic is selected by an Out then in Graphic Channel
 * handoff but remains off every program output until the outgoing graphic
 * finishes; entering, updating, and exiting are the phases of a Graphic
 * Animation.
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

/**
 * The per-Graphic Channel rule for replacing its selected Broadcast Graphic.
 *
 * Overlap starts the outgoing exit and incoming enter together; Out then in
 * waits for the outgoing exit to complete before starting the incoming enter.
 */
export const GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES = ['overlap', 'out-then-in'] as const;

export type GraphicChannelHandoffPolicy = typeof GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES[number];

/**
 * The policy a Graphic Channel has when it does not state one.
 *
 * Absence rather than a written default, so "a Graphic Channel defaults to
 * Overlap" is true of a channel nobody has configured as well as of one whose
 * author chose it.
 */
export const DEFAULT_GRAPHIC_CHANNEL_HANDOFF_POLICY: GraphicChannelHandoffPolicy = 'overlap';

/** An authoring projection of canonical pixel geometry. Storage is always pixels. */
export const GRAPHIC_GEOMETRY_UNIT_VALUES = ['px', 'percent', 'grid'] as const;

export type GraphicGeometryUnit = typeof GRAPHIC_GEOMETRY_UNIT_VALUES[number];

/**
 * Which font a Graphic Item's typography paints with: one of the application
 * fonts that ship with Stream Keepr, or one exact font Graphic Asset Revision
 * from the Graphics Asset Library.
 *
 * A discriminated union rather than two fields, because the two are alternatives
 * rather than a value and an override: a selection that named both would leave
 * the renderer to invent a precedence, and a selection that named neither would
 * leave it to invent a font. The library arm pins an exact revision like every
 * other Graphic Asset Reference does, so a Screen's reference index, its Screen
 * Output Asset Capability, and a Template Package all reach it through the one
 * discovery walk rather than through a font-shaped exception.
 */
export type GraphicFontSelection
	= | { kind: 'application'; fontId: GraphicApplicationFontId }
		| { kind: 'asset'; reference: GraphicAssetReference };

/**
 * A Graphic Font Selection narrowed to the application arm.
 *
 * It exists because one consumer genuinely cannot take the other arm: a Graphic
 * Style Set travels as a `.skstyle` package with no asset envelope, so a Style Set
 * that named a library font would be a Style Set that could not be transferred.
 * See `docs/adr/0001-graphic-style-sets-reference-application-fonts.md`.
 */
export type GraphicApplicationFontSelection = Extract<GraphicFontSelection, { kind: 'application' }>;

/** An application font selection, which is what a newly authored item gets. */
export function applicationGraphicFont(fontId: GraphicApplicationFontId): GraphicApplicationFontSelection {
	return { kind: 'application', fontId };
}

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
	font: GraphicFontSelection;
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

/**
 * How many Graphic Source Selections one Broadcast Graphic may declare, and how many
 * one Broadcast Graphics Screen may hold in total.
 *
 * Here rather than with the write path's other bounds because both sides need them:
 * the schema refuses a config that exceeds either, and the authoring surface has to
 * stop before producing one. The reasoning that chose the numbers — the per-Screen
 * byte budget these two protect — stays with the schema that enforces them.
 */
export const MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC = 8;
export const MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN = 40;

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
	'font' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'textTransform' | 'letterSpacing' | 'color'
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
	/**
	 * Optional recipe-based motion. Absent means this item changes immediately in
	 * every lifecycle phase, which is what a newly authored item gets.
	 */
	animation?: GraphicAnimation;
	/**
	 * Which of this item's property groups are inherited from a Graphic Style Set
	 * entry, and how the author has deviated from each.
	 *
	 * It never holds a value. Every property above stays the authoritative resolved
	 * one, so this item renders, travels, and is copied without its Style Set being
	 * anywhere in reach — which is exactly why a placed copy cannot change under an
	 * author who republishes a Style Set. This is provenance, and it is what turns a
	 * republished entry into a reviewable offer rather than a silent mutation.
	 */
	styleRefs?: GraphicStyleRefs;
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
	= TextGraphicItemConfig
		| ShapeGraphicItemConfig
		| MediaGraphicItemConfig
		| ClockGraphicItemConfig
		| PlayerLifeGraphicItemConfig
		| GameWinsGraphicItemConfig;

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

/**
 * The context-gated Graphic Items.
 *
 * Clock, Player Life, and Game Wins are shared Graphic Item Definitions that
 * require the Feature Match context rather than a Feature Match-specific
 * hierarchy: the same compositor lays them out, animates them, and paints their
 * surfaces, and only the Host Contract's declared context decides whether the
 * palette offers them. Each reads live Feature Match Session state instead of
 * substituting a placeholder, which is why they exist at all — a Graphic Text
 * Template resolves a value once per accepted change, and a ticking clock or a
 * life total is exactly the collection- and time-shaped state `CONTEXT.md` says
 * "require specialised Graphic Items".
 *
 * The player side lives on Player Life and Game Wins rather than in a token key,
 * which is the mirror image of the Feature Match token catalogue's decision. A
 * Text Graphic Item has no side because its template names one — `{player1Name}`
 * — while these two render one player's state with nothing to name it in.
 */

/**
 * How a Player Life Graphic Item marks a change to the life total it renders.
 * The motion belongs to the Definition rather than to a Graphic Animation Recipe:
 * it fires on a value change from the live session rather than on a lifecycle
 * phase, which is not a thing the shared animation vocabulary expresses.
 */
export const PLAYER_LIFE_ANIMATION_VALUES = ['none', 'fade', 'pop', 'slide', 'glow'] as const;
export type PlayerLifeAnimation = typeof PLAYER_LIFE_ANIMATION_VALUES[number];

export const MIN_PLAYER_LIFE_ANIMATION_DURATION_MS = 100;
export const MAX_PLAYER_LIFE_ANIMATION_DURATION_MS = 3000;

/** A Graphic Item that renders the active Feature Match Session clock. */
export interface ClockGraphicItemConfig extends GraphicItemConfigBase {
	type: 'clock';
	typography: GraphicTypography;
	overflowPolicy: TextOverflowPolicy;
	/** The author-set floor a `shrink` Text Overflow Policy shrinks to before ellipsis. */
	minFontSize: number;
	surfaceStyle?: GraphicSurfaceStyle;
}

/** A Graphic Item that renders one Player's life total. */
export interface PlayerLifeGraphicItemConfig extends GraphicItemConfigBase {
	type: 'player-life';
	playerSide: PlayerSide;
	typography: GraphicTypography;
	overflowPolicy: TextOverflowPolicy;
	minFontSize: number;
	lifeAnimation: PlayerLifeAnimation;
	lifeAnimationDurationMs: number;
	/** The colour a `glow` or `slide` change animation tints; ignored by the others. */
	lifeAnimationAccentColor: string;
	surfaceStyle?: GraphicSurfaceStyle;
}

export const GAME_WINS_DISPLAY_MODE_VALUES = ['boxes', 'number'] as const;
export type GameWinsDisplayMode = typeof GAME_WINS_DISPLAY_MODE_VALUES[number];

export const GAME_WINS_BOX_ORIENTATION_VALUES = ['horizontal', 'vertical'] as const;
export type GameWinsBoxOrientation = typeof GAME_WINS_BOX_ORIENTATION_VALUES[number];

/**
 * A Graphic Item that renders one Player's game-win indicators.
 *
 * A box is an ordinary painted surface: it carries a canonical Shape Geometry and
 * two Graphic Surface Styles rather than the legacy widget's own border width and
 * corner radius, so a cut-corner win box is authored with the same controls a
 * Shape Graphic Item uses. The box count comes from the Match's best-of rather
 * than from configuration, so a layout does not restate what the session knows.
 */
export interface GameWinsGraphicItemConfig extends GraphicItemConfigBase {
	type: 'game-wins';
	playerSide: PlayerSide;
	displayMode: GameWinsDisplayMode;
	boxOrientation: GameWinsBoxOrientation;
	boxWidth: number;
	boxHeight: number;
	boxGap: number;
	boxGeometry: ShapeGeometry;
	/** A box this player has not yet won. */
	boxSurfaceStyle: GraphicSurfaceStyle;
	/** A box this player has won. */
	wonBoxSurfaceStyle: GraphicSurfaceStyle;
	/** Renders the win count while the display mode is `number`. */
	typography: GraphicTypography;
	surfaceStyle?: GraphicSurfaceStyle;
}

export type GraphicItemConfig
	= TextGraphicItemConfig
		| ShapeGraphicItemConfig
		| MediaGraphicItemConfig
		| GraphicGroupItemConfig
		| ClockGraphicItemConfig
		| PlayerLifeGraphicItemConfig
		| GameWinsGraphicItemConfig;

export type GraphicItemKind = GraphicItemConfig['type'];

/**
 * An optional playout lane allowing at most one of its Broadcast Graphics to be
 * on air at a time.
 *
 * Authored Screen configuration rather than live state: which lane a graphic
 * runs in is a decision about the show's design, and the channel's current
 * member is derived from the playout intents the Live Session already holds.
 */
export interface GraphicChannelConfig {
	id: string;
	name: string;
	/**
	 * How this channel hands one member over to the next. Absent is Overlap,
	 * which is the policy a Graphic Channel defaults to.
	 */
	handoff?: GraphicChannelHandoffPolicy;
}

/** An authored visual composition shown, hidden, and controlled as one unit. */
export interface BroadcastGraphicConfig {
	id: string;
	name: string;
	/**
	 * The one Graphic Channel this Broadcast Graphic belongs to, or absent for a
	 * graphic that runs concurrently with everything else.
	 *
	 * It never affects Graphic Layer Order: concurrent Broadcast Graphics always
	 * render in their authored Screen stack order, whatever their channel.
	 */
	channelId?: string;
	/** Graphic Layer Order: the back-to-front list order of this graphic's direct Graphic Items. */
	items: GraphicItemConfig[];
	/**
	 * Whole-graphic motion, which composes with the Graphic Animations of its
	 * Graphic Items and may stagger them.
	 */
	animation?: GraphicContainerAnimation;
	/**
	 * The typed Graphic Inputs this Broadcast Graphic declares. Absent declares
	 * none, so a graphic that exposes no operator values carries no key at all.
	 */
	inputs?: GraphicInputDeclaration[];
	/** The single-entity Event Data selections this placed graphic's bindings read. */
	sources?: GraphicSourceSelectionDeclaration[];
	/** Graphic Input Bindings, at most one per Graphic Input. */
	bindings?: GraphicInputBinding[];
	/**
	 * The one Graphic Style Set this composition's inherited properties come from.
	 *
	 * At most one, structurally. Absent means every property in this composition is
	 * local, which is what a Broadcast Graphic authored without a Style Set has and
	 * what detaching from one leaves behind.
	 */
	styleSet?: GraphicStyleSetLink;
	/** Whole-graphic Graphic Animation Recipes inherited from that Style Set. */
	styleRefs?: GraphicContainerStyleRefs;
}
