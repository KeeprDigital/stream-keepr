import type { GraphicFocalPosition, MediaGraphicItemFit } from './graphicItem';
import type {
	GraphicAnimationEasing,
	GraphicAnimationOrigin,
	GraphicFontId,
	GraphicFontStyle,
	GraphicOnScreenAnimationRecipe,
	GraphicRevealEdge,
	GraphicSlideDirection,
	GraphicSlideDistanceMode,
	GraphicSurfaceStyle,
	GraphicTextTransform,
	GraphicTypography,
	MediaGraphicItemConfig,
	ShapeGeometry,
} from './graphics';

/**
 * Graphic Style Sets: the named reusable authoring resource that keeps a family of
 * independently portable graphics templates on one visual and motion language.
 *
 * ## Why an entry stores references rather than values
 *
 * Every entry kind that involves colour stores a *palette entry id* rather than a
 * colour. That is the whole point of a palette: "each entry stores one opaque colour
 * rather than a fixed application role", and "presets may reference multiple palette
 * entries". A typography preset whose colour was a literal string would make a brand
 * colour change a find-and-replace across every preset that happened to use it, which
 * is the problem a Style Set exists to remove.
 *
 * The consequence is that an entry is not directly usable: it has to be *resolved*
 * against its own Style Set before it means anything, and resolution can fail — a
 * dangling reference, a reference to an entry of the wrong kind, a cycle. That is why
 * publish is a validating step rather than a save, and why `shared/modules/graphic-style-sets`
 * owns resolution as a pure function rather than leaving each reader to walk the graph.
 *
 * ## Why entry ids are stable and kinds are not changeable
 *
 * A template references an entry by id, so renaming an entry must not disturb any
 * template — and an entry whose kind changed in place would silently repoint every
 * template that referenced it at a value of a shape their property cannot hold.
 * Renaming is therefore free and re-kinding is impossible: an author deletes and
 * creates instead, which routes them through the replace-or-detach flow that tells
 * every affected template about it.
 *
 * ## What a Style Set never contains
 *
 * No Graphic Item trees, no layout structure, no media asset selections, and no
 * opacity that belongs to a consuming property. A Style Set is vocabulary, not
 * composition.
 */

export const MAX_GRAPHIC_STYLE_SET_NAME_LENGTH = 100;
export const MAX_GRAPHIC_STYLE_SET_DESCRIPTION_LENGTH = 500;
export const MAX_GRAPHIC_STYLE_SET_ENTRY_NAME_LENGTH = 60;

/**
 * How many entries one Style Set may hold.
 *
 * A Style Set is loaded whole by every editor that authors against it and stored as
 * one JSON document, so the bound is on the set rather than per kind: an author who
 * needs a hundred palette colours and no animation recipes is not served by a
 * per-kind cap, and the cost the bound protects is the whole document's.
 */
export const MAX_GRAPHIC_STYLE_SET_ENTRIES = 200;

/**
 * The entry kinds a Graphic Style Set's initial vocabulary offers.
 *
 * Each names one bounded preset that a template property control can reference
 * whole. There is deliberately no "colour role" kind: the palette is an open-ended
 * collection of freely named colours, and what a colour *does* is decided by the
 * preset or property that references it.
 */
export const GRAPHIC_STYLE_ENTRY_KIND_VALUES = [
	'palette',
	'typography',
	'fill',
	'surface-style',
	'media-treatment',
	'shape-geometry',
	'animation-recipe',
] as const;

export type GraphicStyleEntryKind = typeof GRAPHIC_STYLE_ENTRY_KIND_VALUES[number];

/**
 * The configuration version of one entry kind's stored value.
 *
 * It is per entry rather than per Style Set because kinds evolve independently, and
 * because a `.skstyle` package (#76) has to say which shape it froze for each entry
 * it carries rather than for the set as a whole. Everything ships at version 1.
 */
export const GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION = 1;

/** One named palette colour. Opacity belongs to the consuming style property. */
export interface PaletteGraphicStyleEntryValue {
	color: string;
}

/**
 * A typography preset.
 *
 * Alignment, Text Overflow Policy, content, and placeholder mappings stay
 * item-specific, so they are absent here: a preset that carried alignment would make
 * one shared "heading" style unusable for a right-aligned score.
 */
export interface TypographyGraphicStyleEntryValue {
	fontId: GraphicFontId;
	fontSize: number;
	fontWeight: number;
	fontStyle: GraphicFontStyle;
	textTransform: GraphicTextTransform;
	letterSpacing: number;
	lineHeight: number;
	/** Palette-linked text colour. */
	colorEntryId: string;
}

/** One positioned stop of a gradient Graphic Fill preset. */
export interface GraphicStyleFillStop {
	colorEntryId: string;
	position: number;
	opacity: number;
}

/** Either a solid palette reference or a linear gradient of two to four of them. */
export type FillGraphicStyleEntryValue
	= | { type: 'solid'; colorEntryId: string }
		| { type: 'linear-gradient'; angle: number; stops: GraphicStyleFillStop[] };

/**
 * A Graphic Surface Style preset.
 *
 * `fillEntryId` is optional because the glossary says a surface preset *may*
 * reference one Graphic Fill preset — a preset that only standardises an outline and
 * a glow is a real thing an author wants. Shape Geometry stays a separate preset, so
 * a surface preset never carries corners or slants.
 */
export interface SurfaceStyleGraphicStyleEntryValue {
	fillEntryId?: string;
	fillOpacity: number;
	outline?: { colorEntryId: string; width: number };
	glow?: { colorEntryId: string; size: number; opacity: number };
}

/**
 * A media treatment preset: presentation without content.
 *
 * It never selects a media asset — each graphics template selects its own from the
 * Graphics Asset Library — and its `playbackRate` and `loop` defaults are video-only,
 * which an image item stores and ignores exactly as the Media Graphic Item does.
 */
export interface MediaTreatmentGraphicStyleEntryValue {
	fit: MediaGraphicItemFit;
	focalPosition: GraphicFocalPosition;
	opacity: number;
	/** An optional Shape Geometry preset reference used as the clipping boundary. */
	clipGeometryEntryId?: string;
	playbackRate?: number;
	loop?: boolean;
}

/** A Shape Geometry preset: per-corner treatment and bounded edge slants, nothing else. */
export type ShapeGeometryGraphicStyleEntryValue = ShapeGeometry;

/**
 * A Graphic Animation Recipe preset.
 *
 * One bounded fade, slide, scale, and reveal combination with duration, easing, an
 * optional delay, and the on-screen-only repetition defaults. A template assigns it
 * to a lifecycle phase and keeps item selection, staggering, and cross-item
 * choreography local, which is why nothing here names a phase or an item.
 */
export interface AnimationRecipeGraphicStyleEntryValue {
	duration: number;
	easing: GraphicAnimationEasing;
	delay?: number;
	fade?: { opacity: number };
	slide?: {
		direction: GraphicSlideDirection;
		distanceMode: GraphicSlideDistanceMode;
		distance: number;
	};
	scale?: { factor: number; origin: GraphicAnimationOrigin };
	reveal?: { edge: GraphicRevealEdge };
	/** On-screen repetition defaults. Ignored by the enter, update, and exit phases. */
	pause?: number;
	repeat?: number | 'indefinite';
}

export interface GraphicStyleEntryValueByKind {
	'palette': PaletteGraphicStyleEntryValue;
	'typography': TypographyGraphicStyleEntryValue;
	'fill': FillGraphicStyleEntryValue;
	'surface-style': SurfaceStyleGraphicStyleEntryValue;
	'media-treatment': MediaTreatmentGraphicStyleEntryValue;
	'shape-geometry': ShapeGeometryGraphicStyleEntryValue;
	'animation-recipe': AnimationRecipeGraphicStyleEntryValue;
}

/**
 * One Graphic Style Set entry.
 *
 * `id` is the stable identity a template references and a rename never disturbs;
 * `kind` cannot change in place; `schemaVersion` states which shape `value` is in.
 */
export type GraphicStyleSetEntry = {
	[K in GraphicStyleEntryKind]: {
		id: string;
		kind: K;
		name: string;
		schemaVersion: number;
		value: GraphicStyleEntryValueByKind[K];
	};
}[GraphicStyleEntryKind];

/* ────────────────────────────────────────────────
 * Referencing an entry from a graphics template
 * ──────────────────────────────────────────────── */

/**
 * The property slots a Graphic Item or Broadcast Graphic may point at a Graphic
 * Style Set entry.
 *
 * A closed vocabulary rather than a path expression, for the same reason a Graphic
 * Source Relation is: an author picks a preset in the property control that already
 * edits that property, and nothing has to parse, validate, or migrate a path. Each
 * slot names exactly one property group, and the entry kind it accepts is fixed.
 *
 * `surfaceStyle` and `surfaceStyle.fill` deliberately overlap. A Graphic Surface
 * Style preset may itself reference a Graphic Fill preset, so an item that binds
 * both is stating something more specific about its fill than about its surface —
 * and the finer slot is applied last and wins. That ordering is the whole rule;
 * there is no validation refusing the combination, because "a brand surface but
 * this one gradient" is an ordinary thing to want.
 */
export const GRAPHIC_STYLE_SLOT_VALUES = [
	'typography',
	'surfaceStyle',
	'surfaceStyle.fill',
	'defaultChildSurfaceStyle',
	'geometry',
	'clipGeometry',
	'media',
	'animation.enter',
	'animation.on-screen',
	'animation.update',
	'animation.exit',
] as const;

export type GraphicStyleSlot = typeof GRAPHIC_STYLE_SLOT_VALUES[number];

/**
 * The typography properties a typography preset owns.
 *
 * Text alignment is absent because it is item-specific, which makes this a strict
 * subset of `GraphicTypography` rather than an alias for it.
 */
export type GraphicStyleTypographyProperties = Omit<GraphicTypography, 'textAlign'>;

/** The media presentation properties a media treatment preset owns. */
export type GraphicStyleMediaProperties = Pick<
	MediaGraphicItemConfig,
	'fit' | 'focalPosition' | 'opacity' | 'clipGeometry' | 'playbackRate' | 'loop'
>;

/**
 * The recipe properties an animation preset owns.
 *
 * The on-screen phase's `pause` and `repeat` are part of the shape because a preset
 * carries repetition defaults; the other three phases have no such properties and
 * simply never receive them.
 */
export type GraphicStyleAnimationProperties = GraphicOnScreenAnimationRecipe;

/**
 * What each slot's local deviations may say.
 *
 * An override is a *partial* of the property group the slot owns, so a deviation is
 * always property-level: "this heading, one size larger" rather than a whole
 * disconnected typography block. `surfaceStyle.fill` is the exception and takes no
 * overrides at all — a Graphic Fill is a discriminated union with no meaningful
 * partial, so deviating from a Graphic Fill preset means not referencing one.
 */
export interface GraphicStyleOverridesBySlot {
	'typography': Partial<GraphicStyleTypographyProperties>;
	'surfaceStyle': Partial<GraphicSurfaceStyle>;
	'surfaceStyle.fill': Record<string, never>;
	'defaultChildSurfaceStyle': Partial<GraphicSurfaceStyle>;
	'geometry': Partial<ShapeGeometry>;
	'clipGeometry': Partial<ShapeGeometry>;
	'media': Partial<GraphicStyleMediaProperties>;
	'animation.enter': Partial<GraphicStyleAnimationProperties>;
	'animation.on-screen': Partial<GraphicStyleAnimationProperties>;
	'animation.update': Partial<GraphicStyleAnimationProperties>;
	'animation.exit': Partial<GraphicStyleAnimationProperties>;
}

/**
 * One slot's reference to a Graphic Style Set entry, with the local deviations the
 * author has made from it.
 *
 * The property itself is *not* here. A graphics document always stores its own
 * resolved values inline, so it renders without the Style Set being present, travels
 * as a self-contained snapshot, and cannot change under a placed copy. This record
 * is what makes an update reviewable: it says where the value came from and which
 * parts of it the author has since claimed as their own.
 */
export interface GraphicStyleRef<S extends GraphicStyleSlot = GraphicStyleSlot> {
	entryId: string;
	overrides?: GraphicStyleOverridesBySlot[S];
}

export type GraphicStyleRefs = {
	[S in GraphicStyleSlot]?: GraphicStyleRef<S>;
};

/** The slots that name a lifecycle phase's Graphic Animation Recipe. */
export type GraphicAnimationStyleSlot = Extract<GraphicStyleSlot, `animation.${string}`>;

/**
 * The slots a Broadcast Graphic itself may bind.
 *
 * A Broadcast Graphic has no typography, surface, geometry, or media of its own — it
 * owns whole-graphic motion and nothing else — so its references are animation
 * recipes only, stated in the type rather than checked at runtime.
 */
export type GraphicContainerStyleRefs = Pick<GraphicStyleRefs, GraphicAnimationStyleSlot>;

/**
 * A graphics document's link to one Graphic Style Set.
 *
 * At most one per template, stated structurally by this being a single optional
 * field rather than a list. `revision` is the published revision the document's
 * inherited properties were last reconciled to — provenance for a `.skstyle`
 * package and the number an author is shown beside an available update.
 */
export interface GraphicStyleSetLink {
	styleSetId: string;
	revision: number;
}

/** One Graphic Style Set as a library browser reads it, without its entries. */
export interface GraphicStyleSetSummary {
	id: string;
	name: string;
	description: string | null;
	/**
	 * The published revision. Zero means the Style Set has never been published, so
	 * no template can link to it yet.
	 */
	revision: number;
	/** The token a draft write must state, so two authors cannot overwrite each other. */
	draftRevision: number;
	entryCount: number;
	/** Whether the working draft differs from the published revision. */
	hasUnpublishedChanges: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * One Graphic Style Set with both of its entry lists.
 *
 * `draft` is where edits accumulate and `published` is what every linked template
 * resolves against. They are separate documents rather than one list with a dirty
 * flag because that separation is the whole guarantee: an author can restructure the
 * palette all afternoon without a single linked template seeing an available update,
 * and one atomic publish is what moves the two together.
 */
export interface GraphicStyleSetResponse extends GraphicStyleSetSummary {
	draft: GraphicStyleSetEntry[];
	/** Null until the first publish. */
	published: GraphicStyleSetEntry[] | null;
}

export interface GraphicStyleSetListResponse {
	styleSets: GraphicStyleSetSummary[];
}

/**
 * Why a Graphic Style Set draft cannot be published.
 *
 * Every code is stable and names one remediable fault, because a publish that
 * reported "invalid" would leave an author with a hundred entries and nowhere to look.
 */
export const GRAPHIC_STYLE_SET_PUBLISH_ISSUE_CODES = [
	'entry-reference-missing',
	'entry-reference-kind-mismatch',
	'entry-reference-cycle',
	'entry-schema-unsupported',
	'entry-font-unavailable',
] as const;

export type GraphicStyleSetPublishIssueCode = typeof GRAPHIC_STYLE_SET_PUBLISH_ISSUE_CODES[number];

export interface GraphicStyleSetPublishIssue {
	code: GraphicStyleSetPublishIssueCode;
	/** The entry the fault is reported against, so an author can go and look at it. */
	entryId: string;
	entryName: string;
	/** The referenced entry, when the fault is about a reference. */
	referencedEntryId?: string;
	message: string;
}

/**
 * One template a Style Set operation reaches.
 *
 * Named rather than counted: the point of identifying affected templates is that an
 * author can go and review each one, and a count identifies nothing.
 */
export interface AffectedGraphicsTemplate {
	id: string;
	name: string;
	revision: number;
	/** Whether this template's resolved style actually changes. */
	styleChanged: boolean;
}

export interface GraphicStyleSetPublishResponse {
	styleSet: GraphicStyleSetResponse;
	affectedTemplates: AffectedGraphicsTemplate[];
}

export interface GraphicStyleSetPublishRefusal {
	issues: GraphicStyleSetPublishIssue[];
}

/* ────────────────────────────────────────────────
 * Reviewing and applying a Graphic Style Set update
 * ──────────────────────────────────────────────── */

/**
 * One property group a Graphic Style Set update would change in one template.
 *
 * The unit is a slot rather than a field because a slot is what an author decides
 * about: they either take the preset's new statement of this property group or keep
 * what they are looking at. `owner` names the Graphic Item, or is null for the
 * Broadcast Graphic's own animation.
 */
export interface GraphicStyleUpdateChange {
	ownerItemId: string | null;
	ownerLabel: string;
	slot: GraphicStyleSlot;
	entryId: string;
	entryName: string;
	/** The property group as the template currently renders it. */
	current: unknown;
	/** The property group the published Style Set now resolves to, with overrides kept. */
	next: unknown;
}

/**
 * What a linked template's author is offered.
 *
 * `available` is false when the published Style Set resolves to exactly what the
 * template already renders — which is what makes a rename, a new unused entry, or an
 * edit to an entry this template never references a non-event.
 */
export interface GraphicStyleUpdateReview {
	styleSet: {
		id: string;
		name: string;
		/** The revision the template is currently reconciled to. */
		linkedRevision: number;
		/** The Style Set's current published revision. */
		publishedRevision: number;
	} | null;
	available: boolean;
	changes: GraphicStyleUpdateChange[];
}

/**
 * How one slot's change is resolved during review.
 *
 * `inherit` takes the Style Set's new value. `keep-as-override` preserves the
 * previously resolved property by recording it as a new local override, which is the
 * one thing review may do that ordinary application cannot. There is deliberately no
 * "leave this slot alone": an author cannot end up with inherited references spread
 * across a mixture of Style Set revisions, so every slot is decided together and the
 * whole template moves to the published revision in one new template revision.
 */
export const GRAPHIC_STYLE_UPDATE_DECISION_VALUES = ['inherit', 'keep-as-override'] as const;

export type GraphicStyleUpdateDecision = typeof GRAPHIC_STYLE_UPDATE_DECISION_VALUES[number];

/* ────────────────────────────────────────────────
 * Deleting an entry or a whole Style Set
 * ──────────────────────────────────────────────── */

/**
 * How the references to a deleted Graphic Style Set entry are dealt with.
 *
 * `replace` repoints every reference at another entry of the same kind. `detach`
 * freezes each reference's currently resolved value into the template as ordinary
 * local properties. Both run as one atomic operation across every affected template
 * and the Style Set itself: the entry disappears only if every template revision it
 * required succeeded.
 */
export const GRAPHIC_STYLE_ENTRY_DELETION_MODE_VALUES = ['replace', 'detach'] as const;

export type GraphicStyleEntryDeletionMode = typeof GRAPHIC_STYLE_ENTRY_DELETION_MODE_VALUES[number];

/** What deleting an entry or Style Set would reach, before anything is deleted. */
export interface GraphicStyleDeletionImpact {
	/** Entries inside the same Style Set that reference the subject. */
	referencingEntries: { id: string; name: string; kind: GraphicStyleEntryKind }[];
	affectedTemplates: AffectedGraphicsTemplate[];
}
