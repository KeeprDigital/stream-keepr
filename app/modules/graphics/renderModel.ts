import type { CSSProperties } from 'vue';
import type { SocialProfilePresentationProjection } from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicAnimationOwnerValues, GraphicAnimationValues, ShapeGeometrySize } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	ClockGraphicItemConfig,
	GameWinsGraphicItemConfig,
	GraphicAnchorPoint,
	GraphicAnimationPhase,
	GraphicContainerAnimation,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicPlaceholderStyle,
	GraphicRect,
	GraphicRevealEdge,
	GraphicSurfaceStyle,
	MediaGraphicItemConfig,
	PlayerLifeAnimation,
	PlayerLifeGraphicItemConfig,
	ShapeGeometry,
	SocialNetworkIconGraphicItemConfig,
	SocialProfileProjectionValues,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from './selection';
import {
	graphicAnimationStaggerOffset,
	isRectangularShapeGeometry,
	renderGraphicTextTemplate,
	resolveGraphicAnchorPoint,
	resolveGraphicAnimationOrigin,
	resolveGraphicAnimationValues,
	resolveGraphicFontFamily,
	shapeGeometryPath,
	squareShapeGeometry,
} from '~~/shared/modules/graphics';
import { SUPPORTED_SOCIAL_NETWORK_BY_KEY } from '~~/shared/socialProfiles';
import { screenOutputCanvasBackground } from '~~/shared/utils/screenOutput';
import { graphicsSelectionGraphicId, graphicsSelectionKey } from './selection';

/**
 * Shared compositor render-model seam.
 *
 * One composition of Broadcast Graphics in, one Screen Output render model out.
 * Pure: no Vue, no DOM, no host data access — the Screen Output components and
 * the editor preview render the same descriptors from the same inputs, so the
 * Overlay, Fill, and Key Outputs always resolve one composed frame.
 *
 * Advisory preview guides are part of this model only because the editor asks
 * for them explicitly, and they never enter an item's own geometry or clipping —
 * so they cannot clip or constrain an authored Graphic Item.
 *
 * That opt-in travels on the Screen URL rather than being enforced structurally:
 * an ordinary Screen Output URL carries neither the preview embed role nor a guide
 * flag and so draws no guides, but a URL that carries both draws guides wherever it
 * is opened, including a browser used as a program source. Treat them as a
 * convention for editor embedding, not a guarantee about live output.
 *
 * ## Every surface is one path, painted once
 *
 * A Text Graphic Item, Shape Graphic Item, and Graphic Group all paint their
 * Graphic Surface Style through one surface descriptor: a Shape Geometry path,
 * a Graphic Fill, and an optional uniform outline drawn as an inner stroke of
 * that same path. That is why an outline follows a cut corner or a slanted edge
 * instead of being trimmed away by the clip that produced it, and why one pure
 * function decides what every output paints.
 *
 * ## The Key Output is a true alpha matte, by construction
 *
 * Every element paints pure white at its own alpha over a black backdrop. The
 * browser's own source-over compositing then accumulates the matte for free:
 * over a black backdrop, two elements leave a luminance of
 * `a2 + a1 * (1 - a2)`, which is exactly the alpha union
 * `1 - (1 - a1) * (1 - a2)`. Two overlapping half-opaque items composite to
 * 0.75 grey, and their true combined alpha is 0.75. That identity holds to any
 * depth of overlap, so no separate compositing pass is needed or wanted.
 *
 * The identity is not free of preconditions, and these are a contract every
 * later addition to the vocabulary has to honour:
 *
 * - The Key backdrop must stay black (`screenOutputCanvasBackground`).
 * - Every painted element must be pure white at its own alpha. A gradient is
 *   fine — white with varying alpha still accumulates correctly — and group or
 *   element opacity is fine, because it multiplies through. A glow, shadow, or
 *   outline that keeps its authored colour silently breaks the matte, so each
 *   must resolve to white in the Key Output too.
 * - Nothing may use `mix-blend-mode` or a filter that is not plain source-over.
 *   A glow is a `drop-shadow`, which composites its shadow under the source and
 *   then draws the result source-over, so a white glow accumulates like any
 *   other white paint.
 * - A Media Graphic Item must not paint its own colours into the Key Output; it
 *   contributes its alpha as white. `KEY_MEDIA_ALPHA_TO_WHITE` is how: an image
 *   or video element cannot be recoloured by a CSS paint property, so the Key
 *   Output filters its decoded pixels to pure white while leaving every alpha
 *   value exactly as decoded. Element `opacity` then multiplies through, so a
 *   half-opaque media item accumulates like a half-opaque fill.
 *   contributes its alpha as white.
 *
 * ## Graphic Animation, and why it keeps the matte
 *
 * Animation adds exactly three things to a style, and each was chosen because it
 * cannot paint:
 *
 * - `opacity` scales the element's own alpha. The matte identity is stated over
 *   alphas, and an element at alpha `a` under an opacity `o` contributes `a * o`
 *   to both the composed luminance and the true alpha, so it multiplies through
 *   exactly like a Graphic Group's opacity already does.
 * - `transform` and `transformOrigin` move, scale, and rotate what is painted
 *   without changing it. A slide, a scale about a Graphic Animation Origin, and
 *   the authored Graphic Rotation compose into one transform so a single
 *   `transform-origin` serves both: rotation is applied about the Graphic Anchor
 *   Point, and the scale is expressed as a translation plus a scale about that
 *   same point, which is the identity `scale about O = translate((1-s)(O-A)) then
 *   scale about A`.
 * - A reveal wipes with `mask-image`, not `clip-path`. A Graphic Group already
 *   spends `clip-path` on its Shape Geometry clipping, and CSS allows one clip
 *   path per element — a reveal expressed as a clip would silently replace that
 *   clipping, which the vocabulary forbids. A mask composes with an existing clip
 *   instead of competing with it. Its gradient is written as white at an alpha
 *   even though only the alpha is read, so a mask that ever did paint would fail
 *   the same white check as everything else.
 *
 * Nothing here introduces a `filter` beyond the existing glow, a
 * `mix-blend-mode`, or a CSS transition: motion is *sampled* at an elapsed time
 * rather than declared as a transition, so the same instant always produces the
 * same frame in every output and no output can be mid-interpolation on its own
 * schedule.
 */

/**
 * How a Media Graphic Item contributes its alpha as white to the Key Output.
 *
 * `brightness(0)` takes every colour channel to zero and `invert(1)` takes it to
 * one, and neither touches the alpha channel — so a partly transparent PNG or a
 * VP9-alpha video keeps its exact per-pixel alpha while its colour stops
 * existing. This is the only filter the Key Output applies to a media element,
 * and it composites plain source-over like every other white paint.
 *
 * Getting this wrong is invisible in the Overlay Output and wrong on air, which is
 * why it is named rather than inlined at the one place it is used. The Key Output
 * guard in `graphicsRenderModel.test.ts` deliberately re-declares the same string
 * instead of importing this one, so that it states the requirement independently of
 * the module it guards — a model that changed the conversion would still have to
 * satisfy the guard's own copy.
 */
export const KEY_MEDIA_ALPHA_TO_WHITE = 'brightness(0) invert(1)';

/** Advisory action-safe guides sit at a five-percent inset, title-safe at ten percent. */
export const GRAPHICS_ACTION_SAFE_INSET = 0.05;
export const GRAPHICS_TITLE_SAFE_INSET = 0.1;

/**
 * Whether a composition is its Screen Output's own canvas, or one layer inside a
 * canvas its host already paints. Documented in full on the input field below.
 */
export type GraphicsCanvasRole = 'screen-output' | 'layer';

export interface GraphicsCompositionRenderModelInput {
	output: ScreenOutput;
	canvasWidth: number;
	canvasHeight: number;
	/** The Screen's authored back-to-front stack of Broadcast Graphics. */
	graphics: readonly BroadcastGraphicConfig[];
	/**
	 * Which Broadcast Graphics compose into this frame. Omitted composes the
	 * whole stack; the composed order is always the authored stack order.
	 */
	visibleGraphicIds?: readonly string[];
	/**
	 * Which lifecycle phases each Broadcast Graphic is in, and how long it has been in
	 * each, in the order they compose: innermost first. A Broadcast Graphic absent from
	 * this map — or an omitted map, or an empty list — renders at its Graphic Resting
	 * State, which is what an unanimated Screen, a settled on-air graphic, and a
	 * recovered session all resolve to.
	 *
	 * A list rather than one phase because a Broadcast Graphic may be in more than one
	 * lifecycle phase at one instant: an exit interrupting an update or on-screen
	 * cycling has to continue from the state that was actually rendered, so the
	 * interrupted phase and the exit are both in play and this model composes them
	 * rather than choosing between them.
	 */
	animation?: Readonly<Record<string, readonly GraphicsAnimationProjection[]>>;
	/**
	 * The accepted on-air Graphic Input values a Graphic Text Template renders,
	 * keyed by Broadcast Graphic id.
	 *
	 * Accepted values only: a Screen Output renders what an acceptance put on air,
	 * never a working value someone is still editing. A Graphic Input with no value
	 * here renders nothing.
	 */
	inputValues?: Readonly<Record<string, Readonly<Record<string, GraphicInputValue>>>>;
	/**
	 * Correlated Social Profile values supplied by the Broadcast Graphics host,
	 * keyed by Broadcast Graphic id and Social Profile Projection key.
	 */
	socialProfileValues?: Readonly<Record<string, SocialProfileProjectionValues>>;
	/** Sampled synchronized Presentation Group frames, keyed by graphic and projection. */
	socialProfilePresentations?: Readonly<Record<string, Readonly<Record<string, SocialProfilePresentationProjection>>>>;
	/** Correlated Social Profile values an update phase is transitioning away from. */
	outgoingSocialProfileValues?: Readonly<Record<string, SocialProfileProjectionValues>>;
	/**
	 * The rendering an update phase is transitioning *away* from, keyed by Broadcast
	 * Graphic id.
	 *
	 * Present only while a Broadcast Graphic is updating, and only from a Live Session
	 * that has both renderings — which is what lets an output joining mid-update draw
	 * the transition rather than cut to the new values. An entry for a graphic that is
	 * not in an update phase is ignored.
	 */
	outgoingInputValues?: Readonly<Record<string, Readonly<Record<string, GraphicInputValue>>>>;
	/**
	 * Render each Graphic Input's authored default where no value is set.
	 *
	 * An editor preview sets this: it has no Live Session to accept anything, and the
	 * author wants to see the design as they authored it. A live Screen Output must
	 * never set it — an unset value there means an acceptance passed the input over,
	 * and substituting the authored default would put placeholder text on program
	 * wearing the appearance of live data.
	 *
	 * It defaults to off so that the failure mode of forgetting it is a missing value
	 * rather than a fabricated one.
	 */
	substituteAuthoredDefaults?: boolean;
	/**
	 * The placeholder declarations a Graphic Text Template resolves against, when
	 * the host supplies them rather than the composition declaring them.
	 *
	 * A Feature Match Overlay declares no Graphic Inputs: its Host Contract carries
	 * a fixed token catalogue instead, and these are that catalogue in the shape the
	 * shared mechanism already resolves. Omitted keeps the Broadcast Graphics
	 * behaviour of reading each graphic's own `inputs`, so the host that declares
	 * nothing is the one that has to say so.
	 */
	textDeclarations?: readonly GraphicInputDeclaration[];
	/**
	 * The live Feature Match state the context-gated Graphic Items read. Only a host
	 * declaring the Feature Match context supplies one, and only its Screens can
	 * carry an item that reads it.
	 */
	featureMatch?: GraphicsFeatureMatchContext;
	/**
	 * Whether this composition is the Screen Output's own canvas, or one layer
	 * inside a canvas its host already paints.
	 *
	 * `screen-output` paints the backdrop the Screen Output is defined by —
	 * transparent for an Overlay Output, black for a Fill or Key Output — and
	 * establishes the positioning context its items are absolutely placed against.
	 * A Broadcast Graphics Screen is exactly this: the composed frame *is* the
	 * output.
	 *
	 * `layer` paints no backdrop and establishes no positioning. A Feature Match
	 * Overlay paints its own canvas and mounts this above the Frame and the Source
	 * Items, so a backdrop here would be a second opaque copy covering the whole
	 * host-owned layer — solid black in Fill and Key, hiding everything beneath it.
	 * The host positions the layer instead, because the canvas coordinate space
	 * belongs to the Screen and the Frame is drawn in the same space.
	 *
	 * It defaults to `screen-output` so the failure mode of forgetting it is a
	 * visible backdrop rather than an invisible composition.
	 *
	 * The same division decides the guide layer. Guides are drawn over the whole
	 * canvas and are what an author clicks to select, so whoever paints the canvas
	 * draws them: a `layer` host has its own guides for its own host-owned items,
	 * and two guide layers stacked over one canvas would leave whichever landed
	 * underneath unclickable.
	 */
	canvasRole?: GraphicsCanvasRole;
	/** Editor-only selection and item guides. */
	itemGuides?: boolean;
	/** Editor-only advisory action-safe and title-safe guides. */
	safeAreaGuides?: boolean;
	selectedTarget?: GraphicsSelectionTarget;
	/**
	 * Resolves one pinned Graphic Asset Reference to a URL this output may load.
	 *
	 * Injected rather than computed, because a live Screen Output resolves content
	 * only through its Screen Output Asset Capability and the editor preview
	 * resolves it as an author — two different URLs for the same pinned revision,
	 * and neither is something a pure model can decide. An absent resolver, or one
	 * that returns an empty string, renders a Media Graphic Item as its bounds and
	 * nothing else, which is what an unresolvable reference should look like.
	 */
	graphicAssetContentUrl?: (reference: GraphicAssetReference) => string;
	/**
	 * Why this output's own resolver expects to be refused one pinned revision.
	 *
	 * Injected for the same reason the URL resolver is: the answer belongs to the
	 * authoritative side rather than to any pure model. A Media Graphic Item records
	 * its pinned revision's video target compatibility beside its reference, and
	 * that recorded value is what the model would otherwise be believing — but it is
	 * a copy, and a copy the revision's own technical facts can outlive. Where the
	 * two disagree the refusal is right and the copy is stale, so this reconciles
	 * them (#184). An absent resolver leaves the recorded value untouched, which is
	 * what an editor preview and every non-Screen host want.
	 */
	graphicAssetContentRefusal?: (
		reference: GraphicAssetReference,
	) => GraphicMediaIncompatibilityCode | undefined;
}

/**
 * How one output reaches the content it composes, and what it has been told it
 * cannot reach.
 *
 * The pair travels together because both answer for the same pinned reference and
 * both come from the same place — the Screen Output's own capability-backed
 * resolver — so a composition that can resolve a URL can always ask why one was
 * refused.
 */
export interface GraphicAssetContentResolution {
	url: (reference: GraphicAssetReference) => string;
	refusal?: (reference: GraphicAssetReference) => GraphicMediaIncompatibilityCode | undefined;
}

/** The measurement bounds a `shrink` Text Overflow Policy fits text between. */
export interface GraphicTextShrinkBounds {
	minFontSize: number;
	maxFontSize: number;
}

export interface GraphicGradientStopDescriptor {
	offset: string;
	color: string;
	opacity: number;
}

/** A linear-gradient Graphic Fill, projected onto the surface's own bounding box. */
export interface GraphicGradientDescriptor {
	id: string;
	x1: string;
	y1: string;
	x2: string;
	y2: string;
	stops: GraphicGradientStopDescriptor[];
}

export interface GraphicFillDescriptor {
	/** A colour, or `url(#id)` when the fill is a gradient. */
	color: string;
	opacity: number;
	gradient?: GraphicGradientDescriptor;
}

export interface GraphicOutlineDescriptor {
	color: string;
	/** The authored outline width; the stroke is drawn at twice this and clipped. */
	width: number;
	/** The clip that keeps the stroke inside the surface's own path. */
	clipId: string;
}

/**
 * One run of a rendered Graphic Text Template.
 *
 * A run from a `{inputKey}` placeholder carries the typography its Graphic
 * Placeholder Style resolves — and only the properties that style overrides, so a
 * run inherits the item's base typography for everything else. Literal runs carry
 * no style at all, which is the same statement made structurally.
 */
export interface GraphicTextRenderSegment {
	text: string;
	inputKey?: string;
	style?: CSSProperties;
}

/** One painted Graphic Surface Style: a Shape Geometry path, a fill, an outline. */
export interface GraphicSurfaceRenderDescriptor {
	width: number;
	height: number;
	path: string;
	fill: GraphicFillDescriptor;
	outline?: GraphicOutlineDescriptor;
}

/** One Media Graphic Item's asset, and how its element paints inside the item's bounds. */
export interface GraphicMediaRenderDescriptor {
	mediaKind: GraphicMediaKind;
	/**
	 * The URL the element loads. Empty when no asset is pinned, or when this
	 * output cannot currently resolve the pinned revision — in both cases the item
	 * paints nothing rather than a broken element.
	 */
	src: string;
	/**
	 * The element's own paint: fitting, focal position, and opacity, plus the Key
	 * Output's alpha-as-white conversion. Separate from the item style so a media
	 * element's filter can never collide with a glow's.
	 */
	style: CSSProperties;
	/** Silent-video playback. An image item carries both and ignores them. */
	loop: boolean;
	playbackRate: number;
	/**
	 * The pinned revision's own target compatibility, so an output can report a
	 * VP9-alpha video it cannot play rather than showing a blank rectangle.
	 *
	 * Reconciled rather than copied from the item: an authoritative refusal for this
	 * exact revision overrides a recorded value that contradicts it, so a Screen
	 * Output never renders an element for bytes it is about to be refused (#184).
	 */
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	/**
	 * What this output may paint in place of a clip it cannot play.
	 *
	 * Present only where painting is safe. Whether the browser actually can play
	 * the clip is a client fact — the user agent's own engine — that no pure model
	 * can know, so the component asks its runtime for that. What the component
	 * cannot know is which Screen Output it is inside, and that decides whether a
	 * legible notice is a diagnostic or a defect: the Key Output renders composed
	 * opacity as an alpha matte, so text there would punch the message into the key
	 * and put it on program through the downstream mixer. So the model withholds
	 * the notice for the Key Output and offers it for every output that carries
	 * colour.
	 */
	incompatibilityNotice?: GraphicMediaIncompatibilityNoticeDescriptor;
}

/** The same stable code the Screen Output asset routes refuse a revision with. */
export type GraphicMediaIncompatibilityCode = 'vp9-alpha-chromium-required';

/** The rendered reason an output shows instead of a clip it cannot play. */
export interface GraphicMediaIncompatibilityNoticeDescriptor {
	code: GraphicMediaIncompatibilityCode;
	text: string;
	style: CSSProperties;
}

/** One Player's live Feature Match Session state, as the context-gated kinds read it. */
export interface GraphicsFeatureMatchPlayerState {
	/** Absent while the session holds no total, which renders as an empty item. */
	lifeTotal: number | null;
	gameWins: number;
}

/**
 * The live Feature Match state the context-gated Graphic Items read.
 *
 * Supplied by the host rather than fetched here, so the model stays pure and every
 * Screen Output derives the same frame from the same resolved snapshot. Absent
 * means no host declared the Feature Match context — a Broadcast Graphics Screen
 * cannot offer these kinds at all, so nothing on it can need one — and the kinds
 * render their empty state rather than throwing.
 */
export interface GraphicsFeatureMatchContext {
	/** The active Feature Match Session clock, already formatted by its owner. */
	clockDisplayTime: string;
	player1: GraphicsFeatureMatchPlayerState;
	player2: GraphicsFeatureMatchPlayerState;
	/** The Match length, which decides how many win boxes an indicator draws. */
	bestOf: number;
}

/** One game-win indicator box: a painted Shape Geometry that is filled or not. */
export interface GraphicWinBoxRenderDescriptor {
	won: boolean;
	style: CSSProperties;
	surface: GraphicSurfaceRenderDescriptor;
}

/** How a Player Life Graphic Item marks a change to the total it renders. */
export interface GraphicLifeChangeRenderDescriptor {
	animation: PlayerLifeAnimation;
	durationMs: number;
	accentColor: string;
}

/** One application-owned Supported Social Network vector icon. */
export interface GraphicIconRenderDescriptor {
	name: string;
	style: CSSProperties;
}

export interface GraphicItemRenderDescriptor {
	id: string;
	label: string;
	kind: GraphicItemKind;
	/** The item's authored bounds, clipped so nothing renders outside them. */
	style: CSSProperties;
	/** The item's painted Graphic Surface Style, when it resolves one. */
	surface?: GraphicSurfaceRenderDescriptor;
	/** Typography and Text Overflow Policy clamping. Present for Text Graphic Items. */
	textStyle?: CSSProperties;
	/** The Graphic Text Template's fully rendered text. Present for Text Graphic Items. */
	text?: string;
	/**
	 * The same rendered text split into runs, so each `{inputKey}` run can carry its
	 * own Graphic Placeholder Style. Concatenating the runs always reproduces `text`.
	 */
	textSegments?: GraphicTextRenderSegment[];
	shrink?: GraphicTextShrinkBounds;
	/** Present for Media Graphic Items. */
	media?: GraphicMediaRenderDescriptor;
	/** Present for Social Network Icon Graphic Items. */
	icon?: GraphicIconRenderDescriptor;
	/**
	 * Present for a Player Life Graphic Item. The component re-runs it whenever
	 * `text` changes, because the change is a new value from the live session
	 * rather than a lifecycle phase the shared animation vocabulary projects.
	 */
	lifeChange?: GraphicLifeChangeRenderDescriptor;
	/** Present for a Game Wins Graphic Item in `boxes` display mode, in play order. */
	winBoxes?: GraphicWinBoxRenderDescriptor[];
	/** Present for Graphic Groups: the group's direct children, back to front. */
	children?: GraphicItemRenderDescriptor[];
	/** Correlated renderings of one Social Profile Presentation Group, back to front. */
	presentationLayers?: GraphicItemRenderDescriptor[];
	/**
	 * The two renderings an update phase draws for this Graphic Item, overlaid inside
	 * its own box.
	 *
	 * Present only while this item is cross-transitioning, and when it is, this
	 * descriptor paints nothing itself — it is the positioning box, and the pair fills
	 * it. That is what keeps a cross-transition inside Graphic Layer Order: both
	 * renderings sit exactly where this one item sits, so an opaque Graphic Item on a
	 * lower layer cannot cover the rendering being replaced, and one on a higher layer
	 * still covers both. Drawing the old rendering in a second canvas-wide layer put
	 * every outgoing pixel under every incoming one, which silently degraded the
	 * commonest shape this feature has — an updating name over an opaque panel — to a
	 * hard cut.
	 *
	 * Inside the box rather than beside it because a row or column Graphic Group lays
	 * its children out: a second sibling would shift every later child along, while an
	 * overlay consumes no layout at all.
	 */
	crossTransition?: {
		/** Drawn first, so the arriving rendering composites in front of it. */
		outgoing: GraphicItemRenderDescriptor;
		incoming: GraphicItemRenderDescriptor;
	};
	/**
	 * This Graphic Item, drawn inside this descriptor's box.
	 *
	 * Present only when concurrent lifecycle phases each contribute a reveal: CSS allows
	 * one mask per element, so the second wipe needs an element of its own. When it is
	 * present this descriptor paints nothing — it is the item's box carrying one wipe,
	 * and the enclosed descriptor fills it with everything else, Shape Geometry clipping
	 * included.
	 */
	enclosed?: GraphicItemRenderDescriptor;
}

/**
 * One Broadcast Graphic's lifecycle position, as one phase and one elapsed time.
 *
 * Elapsed time rather than a phase progress or a set of per-owner states: the
 * whole point of an authoritative effective start time is that every output
 * derives the same frame from the same single number, and a delayed or staggered
 * recipe inside the graphic works out its own progress from it.
 */
export interface GraphicsAnimationProjection {
	phase: GraphicAnimationPhase;
	/** Milliseconds since this phase's authoritative effective start time. */
	elapsed: number;
}

/**
 * The whole composed Broadcast Graphic, drawn from the rendering an update is
 * replacing.
 *
 * Present only when the *Broadcast Graphic itself* authored an update recipe, which is
 * the one case where drawing everything twice is what the author asked for: a
 * whole-graphic recipe moves the composed frame, so the old frame leaves as the new
 * one arrives, unchanged parts included, and the cross-fade dip through the middle is
 * the effect rather than a defect. Occlusion between the two copies is inherent to
 * that — the old frame passes beneath the new one, which is what a cross-dissolve is.
 *
 * A per-item cross-transition never uses this. It pairs the two renderings inside the
 * crossing item's own box instead, so Graphic Layer Order still composes; see
 * `GraphicItemRenderDescriptor.crossTransition`. The two are mutually exclusive by
 * construction, which is what keeps either from having to reason about the other's
 * stacking.
 */
export interface BroadcastGraphicOutgoingRenderDescriptor {
	style?: CSSProperties;
	items: GraphicItemRenderDescriptor[];
}

export interface BroadcastGraphicRenderDescriptor {
	id: string;
	name: string;
	/** Whole-graphic Graphic Animation, composed over every item it contains. */
	style?: CSSProperties;
	items: GraphicItemRenderDescriptor[];
	/** Present only while an update phase has an old rendering still on screen. */
	outgoing?: BroadcastGraphicOutgoingRenderDescriptor;
	/**
	 * The element every rendering of this Broadcast Graphic sits inside, present only
	 * when one element cannot carry the whole of its composed motion.
	 *
	 * Two things put it there, and both are concurrency. A whole-graphic update draws
	 * two frames, and a phase running over that update — an exit — moves both of them
	 * together: applied to each frame separately it would composite differently, because
	 * two half-opaque copies of one graphic are not the same picture as one half-opaque
	 * copy of the pair. And a second wipe needs a second element, because CSS allows one
	 * mask per element.
	 *
	 * When it is absent, `style` is the whole of the graphic's motion, which is what a
	 * Broadcast Graphic in one lifecycle phase always resolves to.
	 */
	enclosingStyle?: CSSProperties;
}

export type GraphicsSafeAreaGuideId = 'action-safe' | 'title-safe';

export interface GraphicsSafeAreaGuide {
	id: GraphicsSafeAreaGuideId;
	label: string;
	style: CSSProperties;
}

export interface GraphicsItemGuide {
	graphicId: string;
	itemId: string;
	label: string;
	/** This exact Graphic Item is the current selection. */
	selected: boolean;
	/** This item belongs to the Broadcast Graphic under authoring. */
	inSelectedGraphic: boolean;
	style: CSSProperties;
}

export interface GraphicsCompositionRenderModel {
	output: ScreenOutput;
	/**
	 * Echoed from the input so the canvas component knows whether it owns the
	 * backdrop, the positioning, and the guide layer, or whether its host does.
	 */
	canvasRole: GraphicsCanvasRole;
	canvasStyle: CSSProperties;
	graphics: BroadcastGraphicRenderDescriptor[];
	safeAreaGuides: GraphicsSafeAreaGuide[];
	itemGuides: GraphicsItemGuide[];
}

function rectStyle(rect: GraphicRect): CSSProperties {
	return {
		left: `${rect.x}px`,
		top: `${rect.y}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	};
}

function clampOpacity(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

const HEX_COLOUR = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

/**
 * A colour at an alpha, as one CSS value. A Key Output always resolves white, so
 * every painted element keeps the alpha-matte identity.
 */
function alphaColour(output: ScreenOutput, colour: string, opacity: number): string {
	const alpha = clampOpacity(opacity);
	const channel = Math.round(alpha * 255).toString(16).padStart(2, '0');

	if (output === 'key')
		return `#ffffff${channel}`;
	if (alpha >= 1)
		return colour;

	const hex = HEX_COLOUR.exec(colour.trim());
	if (hex)
		return `#${hex[1]}${hex[2]}${hex[3]}${channel}`.toLowerCase();
	return `color-mix(in srgb, ${colour} ${Math.round(alpha * 100)}%, transparent)`;
}

/** A Key Output paints opacity, never colour. */
function paintColour(output: ScreenOutput, colour: string): string {
	return output === 'key' ? '#ffffff' : colour;
}

/**
 * A gradient angle projected onto the surface's own bounding box, in the CSS
 * convention: zero degrees points up, ninety degrees points right.
 */
function gradientAxis(angle: number) {
	const radians = ((Number.isFinite(angle) ? angle : 0) * Math.PI) / 180;
	const dx = Math.sin(radians);
	const dy = -Math.cos(radians);
	const round = (value: number) => `${Math.round(value * 10000) / 10000}`;

	return {
		x1: round(0.5 - (dx / 2)),
		y1: round(0.5 - (dy / 2)),
		x2: round(0.5 + (dx / 2)),
		y2: round(0.5 + (dy / 2)),
	};
}

/**
 * A Graphic Fill as one paint. A gradient keeps its stop opacities and resolves
 * every stop colour to white in the Key Output, which is exactly the case the
 * matte identity allows: white at a varying alpha.
 */
function fillDescriptor(
	output: ScreenOutput,
	style: GraphicSurfaceStyle,
	scope: string,
): GraphicFillDescriptor {
	const opacity = clampOpacity(style.fillOpacity);

	if (style.fill.type === 'solid')
		return { color: paintColour(output, style.fill.color), opacity };

	const gradientId = `graphic-fill-${scope}`;
	return {
		color: `url(#${gradientId})`,
		opacity,
		gradient: {
			id: gradientId,
			...gradientAxis(style.fill.angle),
			stops: style.fill.stops.map(stop => ({
				offset: `${Math.round(clampOpacity(stop.position) * 10000) / 100}%`,
				color: paintColour(output, stop.color),
				opacity: clampOpacity(stop.opacity),
			})),
		},
	};
}

/**
 * SVG `url(#id)` resolution is document-scoped, and every Broadcast Graphic on a
 * Screen composes into one document, so an element id has to be unique across the
 * whole composition rather than within one Broadcast Graphic.
 */
function elementScope(graphicId: string, itemId: string): string {
	return `${graphicId}-${itemId}`;
}

/**
 * One painted surface. The outline is an inner stroke of the same path: drawn at
 * twice its authored width and clipped to the path, so it hugs every corner
 * treatment and edge slant and never leaves the item's authored bounds.
 */
function paintedSurface(
	output: ScreenOutput,
	scope: string,
	size: { width: number; height: number },
	geometry: ShapeGeometry,
	style: GraphicSurfaceStyle,
): GraphicSurfaceRenderDescriptor {
	const outline = style.outline && style.outline.width > 0
		? {
				color: paintColour(output, style.outline.color),
				width: style.outline.width,
				clipId: `graphic-outline-${scope}`,
			}
		: undefined;

	return {
		width: Math.max(0, size.width),
		height: Math.max(0, size.height),
		path: shapeGeometryPath(size, geometry),
		fill: fillDescriptor(output, style, scope),
		outline,
	};
}

/** The same surface, for the kinds whose Graphic Surface Style is optional. */
function surfaceDescriptor(
	output: ScreenOutput,
	scope: string,
	size: { width: number; height: number },
	geometry: ShapeGeometry,
	style: GraphicSurfaceStyle | undefined,
): GraphicSurfaceRenderDescriptor | undefined {
	return style ? paintedSurface(output, scope, size, geometry, style) : undefined;
}

/** A glow is a drop-shadow of the element's own painted alpha. */
function glowFilter(output: ScreenOutput, style: GraphicSurfaceStyle | undefined): string | undefined {
	const glow = style?.glow;
	if (!glow || glow.size <= 0 || clampOpacity(glow.opacity) <= 0)
		return undefined;
	return `drop-shadow(0 0 ${glow.size}px ${alphaColour(output, glow.color, glow.opacity)})`;
}

function transformOrigin(anchor: GraphicAnchorPoint | undefined): string {
	const point = resolveGraphicAnchorPoint(anchor);
	return `${point.x * 100}% ${point.y * 100}%`;
}

/** Trim floating-point noise out of a sampled motion value. */
function motionValue(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * The edge a wipe's mask fades towards. A reveal from the left leaves the left of
 * the element visible, so the mask runs left to right.
 */
const REVEAL_MASK_DIRECTION: Record<GraphicRevealEdge, string> = {
	left: 'to right',
	right: 'to left',
	top: 'to bottom',
	bottom: 'to top',
};

/**
 * A reveal as a hard-edged mask across the owner's rectangular bounds.
 *
 * A mask rather than a clip path, so an owner that already clips to its Shape
 * Geometry keeps that clipping while it wipes. Written as white at full and zero
 * alpha because only the alpha is read, and because a Key Output must never carry
 * a colour that is not white.
 */
function revealMask(values: GraphicAnimationOwnerValues): string | undefined {
	const reveal = values.reveal;
	if (!reveal)
		return undefined;
	const visible = Math.max(0, Math.min(1, reveal.visible));
	if (visible >= 1)
		return undefined;

	const stop = `${motionValue(visible * 100)}%`;
	return `linear-gradient(${REVEAL_MASK_DIRECTION[reveal.edge]}, #ffffff 0 ${stop}, #ffffff00 ${stop})`;
}

/**
 * Every wipe one owner's concurrent lifecycle phases ask for, in the order they were
 * projected.
 *
 * More than one is the case CSS cannot express on a single element: `mask-image`
 * accepts a list, but intersecting the layers needs `mask-composite`, which is not
 * uniformly available to the browsers these outputs are captured in. So the answer is
 * a list and the caller nests — see `enclosingMotionStyle`.
 */
function revealMasks(motion: readonly GraphicAnimationOwnerValues[]): string[] {
	return motion.map(revealMask).filter((mask): mask is string => mask !== undefined);
}

/**
 * One owner's sampled motion, as the smallest set of style properties that
 * expresses it.
 *
 * A slide, the authored Graphic Rotation, and a scale about a Graphic Animation
 * Origin all share one `transform`, in that order: the slide is a canvas-space
 * offset and so is applied outside the rotation, while the scale is applied inside
 * it and about the Graphic Animation Origin, which it reaches by translating from
 * the Graphic Anchor Point that `transform-origin` is already set to.
 *
 * Nothing is emitted for an owner at its Graphic Resting State, so an unanimated
 * composition produces exactly the styles it produced before animation existed.
 *
 * ## Composing concurrent lifecycle phases
 *
 * A Broadcast Graphic may be in more than one lifecycle phase at one instant, so this
 * takes the phases' projections innermost-first and composes them rather than
 * selecting one. Each channel composes the way the channel itself means:
 *
 * - **Fades multiply.** `opacity` is one number, and an element at `a` inside a
 *   parent at `b` contributes `a * b` — so multiplying here is the same arithmetic
 *   nesting would produce, which is what the glossary already says whole-graphic and
 *   item fades do.
 * - **Slides add.** Both are canvas-space offsets applied outside the rotation, so
 *   one `translate` of their sum is exactly the two applied in either order.
 * - **Scales nest.** Each is written as its own `translate(shift) scale(s)` pair
 *   rather than folded into a single factor, because two scales about *different*
 *   Graphic Animation Origins are a scale plus a translation and degenerate when the
 *   factors cancel. Written in reverse order, because a CSS transform list applies
 *   right to left: the phase that moves the result has to be written before the phase
 *   that moves the rendering, and the outer scale then scales the inner shift exactly
 *   as nesting would.
 * - **Reveals cannot.** One element carries one mask, so only the first is emitted
 *   here and the rest are the caller's to nest.
 *
 * Every one of those is still `opacity`, `transform`, and `mask-image` — the three
 * properties the Key Output's alpha matte survives, because each scales or moves alpha
 * without painting anything. Composition adds no fourth.
 */
function motionStyle(
	motion: readonly GraphicAnimationOwnerValues[],
	size: { width: number; height: number },
	rotation: number,
	anchor: GraphicAnchorPoint | undefined,
): CSSProperties {
	const parts: string[] = [];
	let translateX = 0;
	let translateY = 0;
	let opacity: number | undefined;

	for (const values of motion) {
		if (values.translate) {
			translateX += values.translate.x;
			translateY += values.translate.y;
		}
		if (values.opacity !== undefined)
			opacity = (opacity ?? 1) * values.opacity;
	}

	if (translateX !== 0 || translateY !== 0)
		parts.push(`translate(${motionValue(translateX)}px, ${motionValue(translateY)}px)`);

	if (rotation !== 0)
		parts.push(`rotate(${rotation}deg)`);

	for (let index = motion.length - 1; index >= 0; index -= 1) {
		const values = motion[index]!;
		if (values.scale === undefined)
			continue;
		const scale = values.scale;
		const origin = values.scaleOrigin ?? resolveGraphicAnimationOrigin(undefined);
		const anchorPoint = resolveGraphicAnchorPoint(anchor);
		const shiftX = (origin.x - anchorPoint.x) * size.width * (1 - scale);
		const shiftY = (origin.y - anchorPoint.y) * size.height * (1 - scale);
		if (shiftX !== 0 || shiftY !== 0)
			parts.push(`translate(${motionValue(shiftX)}px, ${motionValue(shiftY)}px)`);
		parts.push(`scale(${motionValue(scale)})`);
	}

	const mask = revealMasks(motion)[0];

	return {
		...(parts.length === 0 ? {} : { transform: parts.join(' '), transformOrigin: transformOrigin(anchor) }),
		...(opacity === undefined ? {} : { opacity: motionValue(opacity) }),
		...(mask === undefined ? {} : { maskImage: mask }),
	};
}

/**
 * What the element enclosing this owner has to carry, or nothing when one element is
 * enough.
 *
 * Two things spill out of a single element, and both are concurrency. Motion that
 * belongs to *every* rendering an owner draws — the exit running over an update's
 * pair — cannot sit on either rendering, because opacity applied to each half
 * separately composites differently from opacity applied to the pair. And a second
 * reveal cannot sit anywhere at all, because CSS allows one mask per element.
 *
 * A mask rather than a second `clip-path`, for the reason the single-phase reveal is
 * already a mask: a Graphic Group spends its clip on Shape Geometry clipping, and CSS
 * allows one clip path per element. Nesting masks intersects them by multiplying
 * alpha, which keeps the Key Output's matte exactly as a single mask does — nothing
 * new is painted, so nothing new can be the wrong colour.
 */
function enclosingMotionStyle(
	enclosing: readonly GraphicAnimationOwnerValues[],
	enclosed: readonly GraphicAnimationOwnerValues[],
	size: { width: number; height: number },
	anchor: GraphicAnchorPoint | undefined,
): CSSProperties | undefined {
	// The Graphic Rotation is authored positioning rather than animation, and the
	// enclosed element already applies it, so the enclosure never repeats it.
	const style = motionStyle(enclosing, size, 0, anchor);
	// The second wipe, and only the second: a third would need a third element, and is
	// unreachable while at most two lifecycle phases are ever in play at one instant.
	// `broadcastGraphicPhaseProjections` is where that bound is stated and tested.
	const overflowing = revealMasks(enclosed)[1];
	if (overflowing !== undefined)
		style.maskImage = overflowing;

	return Object.keys(style).length === 0 ? undefined : style;
}

const RESTING: readonly GraphicAnimationOwnerValues[] = [];

/**
 * How many whole lines of text fit inside authored bounds. An `ellipsis` or
 * `shrink` Text Overflow Policy clamps to this many lines, so the last visible
 * line ends in an ellipsis instead of overflowing.
 */
export function graphicTextClampLines(height: number, fontSize: number, lineHeight: number): number {
	const lineBox = fontSize * lineHeight;
	if (!Number.isFinite(lineBox) || lineBox <= 0)
		return 1;
	return Math.max(1, Math.floor(height / lineBox));
}

/**
 * Typography plus the Text Overflow Policy's clipping. No policy renders
 * visible overflow beyond the item's authored bounds: `clip` cuts the
 * overflowing text off, while `ellipsis` and `shrink` clamp to whole lines and
 * end the last one with an ellipsis.
 */
/**
 * What painting text needs from the item painting it.
 *
 * Structural rather than one kind: a Clock and a Player Life render text through
 * exactly this vocabulary without being Text Graphic Items, and neither has a
 * Graphic Text Template for a `TextGraphicItemConfig` to promise.
 */
export type GraphicTextStyled = Pick<TextGraphicItemConfig, 'typography' | 'overflowPolicy' | 'height'>;

export function graphicTextStyle(
	output: ScreenOutput,
	item: GraphicTextStyled,
	fontSize = item.typography.fontSize,
): CSSProperties {
	const typography = item.typography;
	const base: CSSProperties = {
		margin: 0,
		width: '100%',
		color: paintColour(output, typography.color),
		fontFamily: resolveGraphicFontFamily(typography.font),
		fontSize: `${fontSize}px`,
		fontWeight: typography.fontWeight,
		fontStyle: typography.fontStyle,
		textTransform: typography.textTransform,
		letterSpacing: `${typography.letterSpacing}px`,
		lineHeight: typography.lineHeight,
		textAlign: typography.textAlign,
		whiteSpace: 'pre-wrap',
		overflowWrap: 'break-word',
		overflow: 'hidden',
		position: 'relative',
	};

	if (item.overflowPolicy === 'clip')
		return { ...base, textOverflow: 'clip' };

	return {
		...base,
		display: '-webkit-box',
		WebkitBoxOrient: 'vertical',
		WebkitLineClamp: graphicTextClampLines(item.height, fontSize, typography.lineHeight),
		textOverflow: 'ellipsis',
	};
}

const GROUP_ALIGNMENT: Record<GraphicGroupItemConfig['align'], string> = {
	start: 'flex-start',
	center: 'center',
	end: 'flex-end',
	stretch: 'stretch',
};

const GROUP_JUSTIFICATION: Record<GraphicGroupItemConfig['justify'], string> = {
	'start': 'flex-start',
	'center': 'center',
	'end': 'flex-end',
	'space-between': 'space-between',
};

/** The bounds an item occupies on the canvas, plus rotation about its anchor and its sampled motion. */
function canvasPlacement(
	item: GraphicItemConfig,
	offset: { x: number; y: number },
	motion: readonly GraphicAnimationOwnerValues[],
): CSSProperties {
	return {
		...rectStyle({ ...item, x: item.x + offset.x, y: item.y + offset.y }),
		position: 'absolute',
		boxSizing: 'border-box',
		...motionStyle(motion, item, item.rotation ?? 0, item.anchor),
	};
}

/**
 * A row or column child's placement. Fixed sizing pins its main-axis extent;
 * weighted fill shares what remains. Graphic Rotation belongs to canvas
 * positioning, so a stacked child never rotates.
 */
function stackedPlacement(
	group: GraphicGroupItemConfig,
	child: GraphicGroupChildConfig,
	motion: readonly GraphicAnimationOwnerValues[],
): CSSProperties {
	const isRow = group.arrangement === 'row';
	const mainExtent = isRow ? child.width : child.height;
	const sizing = child.sizing ?? { mode: 'fixed' as const, size: mainExtent, weight: 1 };
	const crossExtent = group.align === 'stretch'
		? {}
		: isRow
			? { height: `${child.height}px` }
			: { width: `${child.width}px` };

	return {
		// Load-bearing, and not only for this element's own children: a cross-transitioning
		// child positions both of its renderings `inset: 0` against this box, so removing
		// this as unused would send them out to fill the canvas instead of the child.
		position: 'relative',
		boxSizing: 'border-box',
		flex: sizing.mode === 'fill'
			? `${Math.max(0, sizing.weight)} 1 0`
			: `0 0 ${Math.max(0, sizing.size)}px`,
		alignSelf: GROUP_ALIGNMENT[group.align],
		minWidth: 0,
		minHeight: 0,
		...crossExtent,
		// Graphic Rotation belongs to canvas positioning, but animation does not:
		// a stacked child still slides, scales, fades, and wipes.
		...motionStyle(motion, child, 0, child.anchor),
	};
}

/** A Text Graphic Item is a box that centres its own text block. */
function textBoxStyle(): CSSProperties {
	return {
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'center',
		overflow: 'hidden',
	};
}

function groupBoxStyle(group: GraphicGroupItemConfig): CSSProperties {
	if (group.arrangement === 'canvas')
		return {};

	return {
		display: 'flex',
		flexDirection: group.arrangement === 'row' ? 'row' : 'column',
		gap: `${Math.max(0, group.gap)}px`,
		padding: `${Math.max(0, group.padding)}px`,
		alignItems: GROUP_ALIGNMENT[group.align],
		justifyContent: GROUP_JUSTIFICATION[group.justify],
	};
}

/**
 * A Graphic Group's children never escape its stacking context, and an optional
 * clip holds them inside the group's own Shape Geometry.
 */
function groupClip(group: GraphicGroupItemConfig): CSSProperties {
	if (!group.clip)
		return {};
	if (isRectangularShapeGeometry(group.geometry))
		return { overflow: 'hidden' };
	return {
		clipPath: `path('${shapeGeometryPath(group, group.geometry)}')`,
	};
}

/**
 * A child's own Graphic Surface Style, or the group's local style default.
 *
 * Only a child that can carry one asks: a Media Graphic Item paints an asset
 * rather than a surface, so it has nothing for a group default to fill in.
 */
function resolveChildSurfaceStyle(
	group: GraphicGroupItemConfig,
	child: Exclude<GraphicGroupChildConfig, MediaGraphicItemConfig | SocialNetworkIconGraphicItemConfig>,
): GraphicSurfaceStyle | undefined {
	return child.surfaceStyle ?? group.defaultChildSurfaceStyle;
}

/**
 * A Graphic Placeholder Style as CSS, carrying only what it overrides.
 *
 * Only the overridden properties are emitted so a run inherits everything else
 * from the item's own text style, which is what keeps a placeholder style a
 * typography override rather than a second typography.
 */
function placeholderStyle(
	output: ScreenOutput,
	style: GraphicPlaceholderStyle | undefined,
): CSSProperties | undefined {
	if (!style || Object.keys(style).length === 0)
		return undefined;

	const resolved: CSSProperties = {};
	if (style.font !== undefined)
		resolved.fontFamily = resolveGraphicFontFamily(style.font);
	if (style.fontSize !== undefined)
		resolved.fontSize = `${style.fontSize}px`;
	if (style.fontWeight !== undefined)
		resolved.fontWeight = style.fontWeight;
	if (style.fontStyle !== undefined)
		resolved.fontStyle = style.fontStyle;
	if (style.textTransform !== undefined)
		resolved.textTransform = style.textTransform;
	if (style.letterSpacing !== undefined)
		resolved.letterSpacing = `${style.letterSpacing}px`;
	if (style.color !== undefined)
		resolved.color = paintColour(output, style.color);

	return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/**
 * The values this Broadcast Graphic's Graphic Text Templates render.
 *
 * Whatever acceptance put on air, and — only when the caller asks for it — each
 * declared default underneath. The asking is the whole point: an editor preview
 * wants the design as authored, and a live output must show nothing at all for a
 * value no acceptance produced.
 */
function resolvedInputValues(
	declarations: readonly GraphicInputDeclaration[],
	accepted: Readonly<Record<string, GraphicInputValue>> | undefined,
	substituteAuthoredDefaults: boolean,
): Record<string, GraphicInputValue> {
	if (!substituteAuthoredDefaults)
		return { ...accepted };

	const values: Record<string, GraphicInputValue> = {};
	for (const declaration of declarations)
		values[declaration.key] = declaration.default;
	return { ...values, ...accepted };
}

function textDescriptor(
	output: ScreenOutput,
	scope: string,
	item: TextGraphicItemConfig,
	placement: CSSProperties,
	surfaceStyle: GraphicSurfaceStyle | undefined,
	inputs: GraphicItemContentContext,
): GraphicItemRenderDescriptor {
	const segments = renderGraphicTextTemplate(
		item.text,
		inputs.declarations,
		inputs.values,
		inputs.socialProfileValues,
	)
		.map(segment => ({
			text: segment.text,
			inputKey: segment.inputKey,
			style: segment.inputKey === undefined
				? undefined
				: placeholderStyle(output, item.placeholderStyles?.[segment.inputKey]),
		}));

	return {
		id: item.id,
		label: item.label,
		kind: 'text',
		style: { ...placement, ...textBoxStyle(), filter: glowFilter(output, surfaceStyle) },
		surface: surfaceDescriptor(output, scope, item, squareShapeGeometry(), surfaceStyle),
		textStyle: graphicTextStyle(output, item),
		text: segments.map(segment => segment.text).join(''),
		textSegments: segments,
		shrink: item.overflowPolicy === 'shrink'
			? { minFontSize: item.minFontSize, maxFontSize: item.typography.fontSize }
			: undefined,
	};
}

/**
 * A Clock or Player Life Graphic Item: text the host resolves rather than a
 * Graphic Text Template the author writes.
 *
 * It reuses every part of a Text Graphic Item's paint — surface, typography box,
 * Text Overflow Policy clamping, shrink bounds — because these kinds differ from a
 * Text Graphic Item only in where their string comes from. One segment rather than
 * a run list: there is no placeholder to style when nothing was substituted.
 */
function resolvedTextDescriptor(
	output: ScreenOutput,
	scope: string,
	item: ClockGraphicItemConfig | PlayerLifeGraphicItemConfig,
	text: string,
	placement: CSSProperties,
	surfaceStyle: GraphicSurfaceStyle | undefined,
): GraphicItemRenderDescriptor {
	return {
		id: item.id,
		label: item.label,
		kind: item.type,
		style: { ...placement, ...textBoxStyle(), filter: glowFilter(output, surfaceStyle) },
		surface: surfaceDescriptor(output, scope, item, squareShapeGeometry(), surfaceStyle),
		textStyle: graphicTextStyle(output, item),
		text,
		textSegments: [{ text }],
		shrink: item.overflowPolicy === 'shrink'
			? { minFontSize: item.minFontSize, maxFontSize: item.typography.fontSize }
			: undefined,
		lifeChange: item.type === 'player-life'
			? {
					animation: item.lifeAnimation,
					durationMs: item.lifeAnimationDurationMs,
					accentColor: paintColour(output, item.lifeAnimationAccentColor),
				}
			: undefined,
	};
}

/** A life total as it reads on air: an absent one renders nothing rather than a zero. */
function lifeTotalText(state: GraphicsFeatureMatchPlayerState | undefined): string {
	const total = state?.lifeTotal;
	return total === null || total === undefined ? '' : String(total);
}

/**
 * How many win boxes an indicator draws, and which are filled.
 *
 * The count comes from the Match's own length rather than from configuration, so a
 * best-of-five Match grows the indicator without the layout being re-authored.
 */
function winBoxStates(
	item: GameWinsGraphicItemConfig,
	featureMatch: GraphicsFeatureMatchContext | undefined,
): boolean[] {
	const wins = Math.max(0, Math.floor(featureMatch?.[item.playerSide].gameWins ?? 0));
	const bestOf = Math.max(1, Math.floor(featureMatch?.bestOf ?? 3));
	return Array.from({ length: Math.ceil(bestOf / 2) }, (_, index) => index < wins);
}

/**
 * A Game Wins Graphic Item.
 *
 * The `number` display mode is text and paints exactly like one. The `boxes` mode
 * lays its boxes out along the authored orientation and paints each as an ordinary
 * Shape Geometry surface, so a won box differs from an unwon one only by which
 * Graphic Surface Style it resolves.
 */
function gameWinsDescriptor(
	output: ScreenOutput,
	scope: string,
	item: GameWinsGraphicItemConfig,
	placement: CSSProperties,
	surfaceStyle: GraphicSurfaceStyle | undefined,
	featureMatch: GraphicsFeatureMatchContext | undefined,
): GraphicItemRenderDescriptor {
	const states = winBoxStates(item, featureMatch);
	const base: GraphicItemRenderDescriptor = {
		id: item.id,
		label: item.label,
		kind: 'game-wins',
		surface: surfaceDescriptor(output, scope, item, squareShapeGeometry(), surfaceStyle),
		style: { ...placement, filter: glowFilter(output, surfaceStyle) },
	};

	if (item.displayMode === 'number') {
		const text = String(states.filter(Boolean).length);
		return {
			...base,
			style: { ...base.style, ...textBoxStyle() },
			// A win count is one short number in a box sized for it, so it clips
			// rather than reflowing: there is no Text Overflow Policy to author.
			textStyle: graphicTextStyle(output, { ...item, overflowPolicy: 'clip' }),
			text,
			textSegments: [{ text }],
		};
	}

	const size = { width: item.boxWidth, height: item.boxHeight };
	return {
		...base,
		style: {
			...base.style,
			display: 'flex',
			flexDirection: item.boxOrientation === 'vertical' ? 'column' : 'row',
			alignItems: 'center',
			justifyContent: 'center',
			gap: `${item.boxGap}px`,
			overflow: 'hidden',
		},
		winBoxes: states.map((won, index) => ({
			won,
			style: { ...size, flex: '0 0 auto', position: 'relative' },
			surface: paintedSurface(
				output,
				`${scope}-box-${index}`,
				size,
				item.boxGeometry,
				won ? item.wonBoxSurfaceStyle : item.boxSurfaceStyle,
			),
		})),
	};
}

/**
 * A Media Graphic Item's optional Shape Geometry clipping.
 *
 * Absent clipping still hides overflow, because a `cover` fit deliberately
 * overflows the box it fills and nothing may paint outside an item's authored
 * bounds. A rectangular clip needs no path for the same reason a Graphic Group's
 * does not.
 *
 * A `path()` clip is in user units, so it is only correct against the box it was
 * measured from. `size` is that box when the model knows it, and absent when the
 * browser's own layout decides it — a weighted-fill child, or one its Graphic Group
 * stretches. In that case the item clips to its rectangle instead of applying a
 * path measured against the wrong box: an ignored shape is visible to its author,
 * while a misapplied one looks deliberate and is not.
 */
function mediaClip(item: MediaGraphicItemConfig, size: ShapeGeometrySize | undefined): CSSProperties {
	if (!item.clipGeometry || isRectangularShapeGeometry(item.clipGeometry) || !size)
		return { overflow: 'hidden' };
	return {
		overflow: 'hidden',
		clipPath: `path('${shapeGeometryPath(size, item.clipGeometry)}')`,
	};
}

/**
 * The box a Graphic Group child really occupies, when that is knowable without
 * laying anything out.
 *
 * A canvas child keeps its authored rectangle. A row or column child keeps it only
 * while both axes are pinned: fixed main-axis sizing gives the main extent, and a
 * group that is not stretching leaves the cross extent authored. Anything else is
 * the browser's to decide.
 */
function stackedChildClipSize(
	group: GraphicGroupItemConfig,
	child: GraphicGroupChildConfig,
): ShapeGeometrySize | undefined {
	if (group.arrangement === 'canvas')
		return child;
	if (group.align === 'stretch')
		return undefined;
	const sizing = child.sizing ?? { mode: 'fixed' as const, size: 0, weight: 1 };
	if (sizing.mode !== 'fixed')
		return undefined;
	return group.arrangement === 'row'
		? { width: Math.max(0, sizing.size), height: child.height }
		: { width: child.width, height: Math.max(0, sizing.size) };
}

/**
 * The reason a clip this output cannot play shows, when showing it is safe.
 *
 * The words carry the stable code as well as plain language, because the two
 * readers differ: an operator reads "needs Chromium" and switches capture, and
 * whoever they report it to searches for `vp9-alpha-chromium-required` and finds
 * the same code on the refusal the Screen Output asset route answers with.
 *
 * It is painted opaquely over the item's whole box rather than as bare text,
 * because the box it replaces may be over anything.
 *
 * It carries the item's own opacity, exactly as the media element does. Without
 * that, an item authored transparent — or at zero — would paint a solid black box
 * on air where it previously painted nothing at all, which is a worse defect than
 * the blank rectangle this notice exists to replace. At zero the notice disappears
 * with the item, and nothing is lost: an invisible item has no clip to report.
 */
function mediaIncompatibilityNotice(
	output: ScreenOutput,
	item: MediaGraphicItemConfig,
	videoCompatibility: MediaGraphicItemConfig['videoCompatibility'],
): GraphicMediaIncompatibilityNoticeDescriptor | undefined {
	if (
		output === 'key'
		|| item.mediaKind !== 'silent-video'
		|| videoCompatibility !== 'chromium-transparency'
	) {
		return undefined;
	}
	return {
		code: 'vp9-alpha-chromium-required',
		text: 'Video needs Chromium (vp9-alpha-chromium-required)',
		style: {
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '8px',
			boxSizing: 'border-box',
			backgroundColor: 'rgba(0, 0, 0, 0.78)',
			color: '#ffffff',
			fontFamily: 'system-ui, sans-serif',
			fontSize: '16px',
			lineHeight: 1.25,
			textAlign: 'center',
			overflow: 'hidden',
			overflowWrap: 'anywhere',
			opacity: clampOpacity(item.opacity),
		},
	};
}

/**
 * One Media Graphic Item's element paint.
 *
 * Focal position is where `objectPosition` puts the asset inside the box, which
 * is what decides which part of a `cover` fit survives the crop. In the Key
 * Output the element is filtered to white at its own alpha; see
 * `KEY_MEDIA_ALPHA_TO_WHITE`.
 *
 * The compatibility it carries is reconciled rather than copied. The item records
 * its pinned revision's own video target compatibility, and the write path keeps
 * that copy equal to the revision's technical facts — but only at the moment it is
 * written, and only for configurations this system accepts. Where the output's own
 * resolver has been told the authoritative side refuses the revision, that refusal
 * is the revision's facts speaking and the recorded copy is stale, so the refusal
 * wins. Reconciling here rather than in the component is what keeps the answer in
 * one place: the notice and the withheld element are then two readings of one
 * value instead of two independent decisions over one rule (#184).
 *
 * The refusal can itself be stale, in the opposite direction. It is a snapshot the
 * Screen Output took when it opened its capability session, so facts corrected
 * since then make this withhold an element the server would now serve. Preferring
 * it anyway is deliberate: a notice naming a real refusal code is legible and
 * self-correcting on the next session, while trusting the configuration is what
 * produced a silent blank rectangle. See `useScreenGraphicAssetContentUrls` for
 * why the client does not watch a revision's facts for changes.
 */
function mediaDescriptor(
	output: ScreenOutput,
	item: MediaGraphicItemConfig,
	assetContent: GraphicAssetContentResolution | undefined,
): GraphicMediaRenderDescriptor {
	const refusal = item.asset && assetContent?.refusal
		? assetContent.refusal(item.asset)
		: undefined;
	const videoCompatibility = refusal === 'vp9-alpha-chromium-required'
		? 'chromium-transparency'
		: item.videoCompatibility;
	return {
		mediaKind: item.mediaKind,
		src: item.asset && assetContent ? assetContent.url(item.asset) : '',
		style: {
			display: 'block',
			width: '100%',
			height: '100%',
			objectFit: item.fit,
			objectPosition: `${clampOpacity(item.focalPosition.horizontal) * 100}% ${clampOpacity(item.focalPosition.vertical) * 100}%`,
			opacity: clampOpacity(item.opacity),
			filter: output === 'key' ? KEY_MEDIA_ALPHA_TO_WHITE : undefined,
		},
		loop: item.loop,
		playbackRate: item.playbackRate,
		videoCompatibility,
		incompatibilityNotice: mediaIncompatibilityNotice(output, item, videoCompatibility),
	};
}

function mediaItemDescriptor(
	output: ScreenOutput,
	item: MediaGraphicItemConfig,
	placement: CSSProperties,
	assetContent: GraphicAssetContentResolution | undefined,
	clipSize: ShapeGeometrySize | undefined,
): GraphicItemRenderDescriptor {
	return {
		id: item.id,
		label: item.label,
		kind: 'media',
		style: { ...placement, ...mediaClip(item, clipSize) },
		media: mediaDescriptor(output, item, assetContent),
	};
}

function socialNetworkIconDescriptor(
	output: ScreenOutput,
	item: SocialNetworkIconGraphicItemConfig,
	placement: CSSProperties,
	inputs: GraphicItemContentContext,
): GraphicItemRenderDescriptor {
	const network = typeof item.network === 'string'
		? item.network
		: inputs.socialProfileValues?.[item.network.projectionKey]?.network;
	return {
		id: item.id,
		label: item.label,
		kind: 'social-network-icon',
		style: placement,
		icon: network
			? {
					name: SUPPORTED_SOCIAL_NETWORK_BY_KEY[network].icon,
					style: {
						display: 'block',
						width: '100%',
						height: '100%',
						color: paintColour(output, item.color),
						opacity: clampOpacity(item.opacity),
					},
				}
			: undefined,
	};
}

/** What one Broadcast Graphic's Graphic Text Templates resolve their placeholders from. */
/**
 * Everything one Broadcast Graphic's items resolve their content from.
 *
 * The declarations and values answer a Graphic Text Template's placeholders, and
 * come either from the graphic's own Graphic Inputs or from the host's token
 * catalogue — the model does not care which, because a host token is exactly a
 * text declaration whose value the host supplies. The Feature Match state answers
 * the context-gated kinds, which read live session state instead.
 */
interface GraphicItemContentContext {
	declarations: readonly GraphicInputDeclaration[];
	values: Readonly<Record<string, GraphicInputValue>>;
	socialProfileValues?: SocialProfileProjectionValues;
	socialProfilePresentations?: Readonly<Record<string, SocialProfilePresentationProjection>>;
	featureMatch?: GraphicsFeatureMatchContext;
}

/** What a Clock or Player Life Graphic Item renders, given the host's session state. */
function contextText(
	item: ClockGraphicItemConfig | PlayerLifeGraphicItemConfig,
	featureMatch: GraphicsFeatureMatchContext | undefined,
): string {
	return item.type === 'clock'
		? featureMatch?.clockDisplayTime ?? ''
		: lifeTotalText(featureMatch?.[item.playerSide]);
}

function childDescriptor(
	output: ScreenOutput,
	graphicId: string,
	group: GraphicGroupItemConfig,
	child: GraphicGroupChildConfig,
	assetContent: GraphicAssetContentResolution | undefined,
	inputs: GraphicItemContentContext,
	placement: CSSProperties,
): GraphicItemRenderDescriptor {
	const scope = elementScope(graphicId, child.id);

	// A Media Graphic Item carries no Graphic Surface Style, so it never inherits
	// its Graphic Group's local style default either: there is nothing on it for
	// that default to fill in.
	if (child.type === 'media')
		return mediaItemDescriptor(output, child, placement, assetContent, stackedChildClipSize(group, child));
	if (child.type === 'social-network-icon')
		return socialNetworkIconDescriptor(output, child, placement, inputs);

	const surfaceStyle = resolveChildSurfaceStyle(group, child);

	if (child.type === 'text')
		return textDescriptor(output, scope, child, placement, surfaceStyle, inputs);

	if (child.type === 'clock' || child.type === 'player-life') {
		return resolvedTextDescriptor(
			output,
			scope,
			child,
			contextText(child, inputs.featureMatch),
			placement,
			surfaceStyle,
		);
	}

	if (child.type === 'game-wins')
		return gameWinsDescriptor(output, scope, child, placement, surfaceStyle, inputs.featureMatch);

	return {
		id: child.id,
		label: child.label,
		kind: 'shape',
		style: { ...placement, filter: glowFilter(output, surfaceStyle) },
		surface: surfaceDescriptor(output, scope, child, child.geometry, surfaceStyle),
	};
}

/**
 * The box a cross-transitioning owner's two renderings share.
 *
 * The pair fills the owner's own box, so this is the placement with every trace of
 * motion and paint removed: motion belongs to each half, and the box is only there to
 * put both halves where the one item goes.
 *
 * It requires the placement it is given to establish a positioning context, because each
 * half is `position: absolute; inset: 0` against it. Every placement does — a top-level
 * or canvas-group item is `absolute` and a row or column child is `relative` — and
 * `.graphics-compositor-item` sets no `position` of its own, so there is no fallback if
 * one ever stopped. Both halves would escape to the canvas rather than fail visibly.
 */
function crossTransitionBox(placement: CSSProperties): CSSProperties {
	const { transform, transformOrigin, opacity, maskImage, filter, ...box } = placement;
	return box;
}

/** Where one half of a cross-transition sits: filling the shared box, under its own motion. */
function crossTransitionHalf(
	motion: readonly GraphicAnimationOwnerValues[],
	size: { width: number; height: number },
	rotation: number,
	anchor: GraphicAnchorPoint | undefined,
): CSSProperties {
	return {
		position: 'absolute',
		inset: '0',
		boxSizing: 'border-box',
		...motionStyle(motion, size, rotation, anchor),
	};
}

/**
 * One Graphic Item, wrapped in an enclosing element when its composed motion asks for
 * more masking than one element can carry.
 *
 * Two concurrent lifecycle phases may each contribute a reveal — an on-screen wipe
 * still cycling while an exit wipe runs over it — and CSS allows one `mask-image` per
 * element. The second wipe therefore gets an element of its own: the enclosure takes
 * the item's box so the gradient still resolves across the bounds the reveal was
 * authored across, and the item fills that box carrying everything else.
 *
 * It is a mask on a second element rather than a `clip-path`, for the same reason the
 * first wipe is a mask: a Graphic Group already spends its clip on Shape Geometry
 * clipping, and that clipping stays exactly where it was — on the item, inside the
 * enclosure. Nesting masks multiplies alpha, so the Key Output's matte accumulates
 * exactly as it does under one mask, and nothing new is painted.
 *
 * The wrapper appears only when it is needed. One phase, or two phases where at most
 * one wipes, produce precisely the descriptor they produced before concurrency existed.
 */
function enclosedItemDescriptor(
	motion: readonly GraphicAnimationOwnerValues[],
	owner: GraphicItemConfig | GraphicGroupChildConfig,
	rotation: number,
	placementOf: (motion: readonly GraphicAnimationOwnerValues[]) => CSSProperties,
	paint: (placement: CSSProperties) => GraphicItemRenderDescriptor,
): GraphicItemRenderDescriptor {
	const enclosingStyle = enclosingMotionStyle(RESTING, motion, owner, owner.anchor);
	if (!enclosingStyle)
		return paint(placementOf(motion));

	return {
		id: owner.id,
		label: owner.label,
		kind: owner.type,
		style: { ...crossTransitionBox(placementOf(RESTING)), ...enclosingStyle },
		enclosed: paint(crossTransitionHalf(motion, owner, rotation, owner.anchor)),
	};
}

/**
 * One top-level Graphic Item, paired with the rendering it is replacing when it crosses.
 *
 * The pair is overlaid inside the item's own box rather than drawn as a second
 * canvas-wide layer, so both renderings occupy this item's place in Graphic Layer
 * Order: an opaque item below cannot cover the rendering being replaced, and one above
 * still covers both.
 */
function itemDescriptor(
	output: ScreenOutput,
	graphicId: string,
	item: GraphicItemConfig,
	assetContent: GraphicAssetContentResolution | undefined,
	inputs: GraphicItemContentContext,
	context: GraphicsItemAnimationContext,
	presentation?: { key: string; frame: SocialProfilePresentationProjection },
): GraphicItemRenderDescriptor {
	const motion = context.motionOf(item, context.staggerOffsets, context.parent);
	const rotation = item.rotation ?? 0;

	if (item.type === 'group' && presentation?.frame.phase.kind === 'transition') {
		return enclosedItemDescriptor(
			motion,
			item,
			rotation,
			values => canvasPlacement(item, { x: 0, y: 0 }, values),
			placement => ({
				id: item.id,
				label: item.label,
				kind: item.type,
				style: { ...placement, overflow: 'hidden' },
				presentationLayers: presentation.frame.layers.map(layer => paintedItemDescriptor(
					output,
					graphicId,
					item,
					assetContent,
					{
						...inputs,
						socialProfileValues: {
							...inputs.socialProfileValues,
							[presentation.key]: layer.values,
						},
					},
					context,
					{
						position: 'absolute',
						inset: '0',
						width: '100%',
						height: '100%',
						opacity: layer.opacity,
						transform: `translate(${layer.offsetX}%, ${layer.offsetY}%)`,
					},
				)),
			}),
		);
	}

	if (!context.crossing?.(item.id)) {
		return enclosedItemDescriptor(
			motion,
			item,
			rotation,
			values => canvasPlacement(item, { x: 0, y: 0 }, values),
			placement => paintedItemDescriptor(output, graphicId, item, assetContent, inputs, context, placement),
		);
	}

	// The pair carries the update; whatever else is in play moves the pair, so it goes on
	// the box both renderings sit inside rather than on either of them. The box takes no
	// rotation: the Graphic Rotation is authored positioning and each half applies it.
	const placement = {
		...crossTransitionBox(canvasPlacement(item, { x: 0, y: 0 }, RESTING)),
		...motionStyle(enclosingMotion(context.phases, motion), item, 0, item.anchor),
	};
	const half = (values: readonly GraphicAnimationOwnerValues[]) =>
		crossTransitionHalf(crossingMotion(context.phases, values), item, rotation, item.anchor);

	/**
	 * The context each half hands to its own children.
	 *
	 * `crossing` is dropped, so only the outermost qualifying owner pairs. A Graphic
	 * Group's rendered content is its children's, so a changed child makes its group
	 * changed too and both qualify — and pairing the child again inside each half would
	 * draw it four times, with both copies inside the outgoing half resolving from the
	 * outgoing values. The gate is dropped here rather than in `updateCrossTransition`
	 * because that set does double duty: it also decides which owners an update recipe
	 * may animate, and a child's own recipe is meant to compose with its group's exactly
	 * as an item's composes with a whole-graphic one. Narrowing the set would silence the
	 * child's motion along with its pairing.
	 *
	 * `motionOf` is swapped for the half's own, which is the part that is easy to miss:
	 * without it the children of the rendering being *replaced* would animate on the
	 * arriving rendering's schedule.
	 */
	const halfContext = (motionOf: GraphicsItemAnimationContext['motionOf']): GraphicsItemAnimationContext => ({
		phases: context.phases,
		staggerOffsets: context.staggerOffsets,
		parent: context.parent,
		motionOf,
	});

	return {
		id: item.id,
		label: item.label,
		kind: item.type,
		style: placement,
		crossTransition: {
			outgoing: paintedItemDescriptor(
				output,
				graphicId,
				item,
				assetContent,
				context.outgoing!.inputs,
				halfContext(context.outgoing!.motionOf),
				half(context.outgoing!.motionOf(item, context.staggerOffsets, context.parent)),
			),
			incoming: paintedItemDescriptor(
				output,
				graphicId,
				item,
				assetContent,
				inputs,
				halfContext(context.motionOf),
				half(motion),
			),
		},
	};
}

function paintedItemDescriptor(
	output: ScreenOutput,
	graphicId: string,
	item: GraphicItemConfig,
	assetContent: GraphicAssetContentResolution | undefined,
	inputs: GraphicItemContentContext,
	context: GraphicsItemAnimationContext,
	placement: CSSProperties,
): GraphicItemRenderDescriptor {
	const scope = elementScope(graphicId, item.id);

	if (item.type === 'text')
		return textDescriptor(output, scope, item, placement, item.surfaceStyle, inputs);

	// A top-level Graphic Item always occupies its authored rectangle.
	if (item.type === 'media')
		return mediaItemDescriptor(output, item, placement, assetContent, item);
	if (item.type === 'social-network-icon')
		return socialNetworkIconDescriptor(output, item, placement, inputs);

	if (item.type === 'shape') {
		return {
			id: item.id,
			label: item.label,
			kind: 'shape',
			style: { ...placement, filter: glowFilter(output, item.surfaceStyle) },
			surface: surfaceDescriptor(output, scope, item, item.geometry, item.surfaceStyle),
		};
	}

	if (item.type === 'clock' || item.type === 'player-life') {
		return resolvedTextDescriptor(
			output,
			scope,
			item,
			contextText(item, inputs.featureMatch),
			placement,
			item.surfaceStyle,
		);
	}

	if (item.type === 'game-wins')
		return gameWinsDescriptor(output, scope, item, placement, item.surfaceStyle, inputs.featureMatch);

	return {
		id: item.id,
		label: item.label,
		kind: 'group',
		style: {
			...placement,
			...groupBoxStyle(item),
			...groupClip(item),
			filter: glowFilter(output, item.surfaceStyle),
		},
		surface: surfaceDescriptor(output, scope, item, item.geometry, item.surfaceStyle),
		children: item.children
			.filter(child => child.visible)
			.map(child => groupChildDescriptor(output, graphicId, item, child, assetContent, inputs, context)),
	};
}

/**
 * One Graphic Group child, paired with the rendering it is replacing when it crosses.
 *
 * The pair goes inside the child's own box because a row or column group lays its
 * children out: a second sibling would shift every later child along, while an overlay
 * consumes no layout.
 */
function groupChildDescriptor(
	output: ScreenOutput,
	graphicId: string,
	group: GraphicGroupItemConfig,
	child: GraphicGroupChildConfig,
	assetContent: GraphicAssetContentResolution | undefined,
	inputs: GraphicItemContentContext,
	context: GraphicsItemAnimationContext,
): GraphicItemRenderDescriptor {
	// A child's own delay is offset by its group's stagger, on top of whatever offset the
	// group itself received: both are measured from the one shared phase start. A
	// `clear-parent` slide clears the group, not the canvas, because the group is the
	// child's parent.
	const staggerOffsets = staggerOffsetsFor(
		context.phases,
		group.animation,
		group.children.map(entry => entry.id),
		child.id,
		context.staggerOffsets,
	);
	const motion = context.motionOf(child, staggerOffsets, group);
	const rotation = group.arrangement === 'canvas' ? child.rotation ?? 0 : 0;
	const placementOf = (values: readonly GraphicAnimationOwnerValues[]) => group.arrangement === 'canvas'
		? canvasPlacement(child, { x: Math.max(0, group.padding), y: Math.max(0, group.padding) }, values)
		: stackedPlacement(group, child, values);

	if (!context.crossing?.(child.id)) {
		return enclosedItemDescriptor(
			motion,
			child,
			rotation,
			placementOf,
			placement => childDescriptor(output, graphicId, group, child, assetContent, inputs, placement),
		);
	}

	const half = (values: readonly GraphicAnimationOwnerValues[]) =>
		crossTransitionHalf(crossingMotion(context.phases, values), child, rotation, child.anchor);

	return {
		id: child.id,
		label: child.label,
		kind: child.type,
		style: {
			...crossTransitionBox(placementOf(RESTING)),
			...motionStyle(enclosingMotion(context.phases, motion), child, 0, child.anchor),
		},
		crossTransition: {
			outgoing: childDescriptor(
				output,
				graphicId,
				group,
				child,
				assetContent,
				context.outgoing!.inputs,
				half(context.outgoing!.motionOf(child, staggerOffsets, group)),
			),
			incoming: childDescriptor(output, graphicId, group, child, assetContent, inputs, half(motion)),
		},
	};
}

/** The ordered offset one owner's container added to its delay, per lifecycle phase. */
type GraphicStaggerOffsets = Partial<Record<GraphicAnimationPhase, number>>;

/**
 * One container's stagger for every phase in play, added to whatever offset the
 * container itself received.
 *
 * A stagger is authored per phase, so concurrent phases can order the same children
 * differently — or one of them not at all — and each phase's recipe still measures its
 * own delay from its own shared phase start.
 */
function staggerOffsetsFor(
	phases: readonly GraphicAnimationPhase[],
	animation: GraphicContainerAnimation | undefined,
	directItemIds: readonly string[],
	itemId: string,
	inherited: GraphicStaggerOffsets = {},
): GraphicStaggerOffsets {
	const offsets: GraphicStaggerOffsets = {};
	for (const phase of phases) {
		offsets[phase] = (inherited[phase] ?? 0)
			+ graphicAnimationStaggerOffset(animation?.stagger?.[phase], directItemIds, itemId);
	}
	return offsets;
}

/**
 * The motion of every phase except the update, which a cross-transitioning owner's
 * pair of renderings carries instead.
 *
 * This is the split that lets an exit run over an update rather than beside it: the
 * update moves each rendering separately, and everything else moves the pair, so
 * everything else belongs on the element the pair sits inside.
 */
function enclosingMotion(
	phases: readonly GraphicAnimationPhase[],
	motion: readonly GraphicAnimationOwnerValues[],
): GraphicAnimationOwnerValues[] {
	return motion.filter((_, index) => phases[index] !== 'update');
}

/** The update phase's own motion, which each half of a cross-transition carries. */
function crossingMotion(
	phases: readonly GraphicAnimationPhase[],
	motion: readonly GraphicAnimationOwnerValues[],
): GraphicAnimationOwnerValues[] {
	return motion.filter((_, index) => phases[index] === 'update');
}

/**
 * How one Broadcast Graphic's items find their own motion.
 *
 * Bundled rather than passed as five arguments because every owner needs the same
 * phase, the same elapsed time, and the same canvas, and only the stagger offset
 * and the parent bounds differ between them.
 */
interface GraphicsItemAnimationContext {
	/**
	 * The lifecycle phases in play, in the order they compose: innermost first.
	 *
	 * Every motion array in this context is aligned to it, so a caller that has to
	 * separate an update from the phase running over it can do so by index rather than
	 * by asking each owner again.
	 */
	phases: readonly GraphicAnimationPhase[];
	/**
	 * The offset this item's own container added to its delay, per phase in play.
	 *
	 * Per phase because a stagger is authored per phase: a group may stagger its
	 * children on the way in and not on the way out, so one offset cannot describe two
	 * concurrent phases.
	 */
	staggerOffsets: GraphicStaggerOffsets;
	/** The bounds a `clear-parent` slide has to leave. */
	parent: { width: number; height: number };
	motionOf: (
		owner: GraphicItemConfig | GraphicGroupChildConfig,
		staggerOffsets: GraphicStaggerOffsets,
		parent: { width: number; height: number },
	) => readonly GraphicAnimationOwnerValues[];
	/**
	 * Whether this owner draws both renderings of an update, overlaid in its own box.
	 *
	 * Absent whenever nothing is cross-transitioning per item — outside an update phase,
	 * and inside one when the Broadcast Graphic's own recipe is what crosses, because
	 * then the whole composed frame is drawn twice instead.
	 */
	crossing?: (ownerId: string) => boolean;
	/** The rendering being replaced: its Graphic Input values, and its half of the motion. */
	outgoing?: {
		inputs: GraphicItemContentContext;
		motionOf: GraphicsItemAnimationContext['motionOf'];
	};
}

/**
 * The animation context for one Broadcast Graphic, or a resting one when nothing
 * is being projected for it.
 *
 * A graphic absent from the projection map is settled at its Graphic Resting
 * State — the case that covers an unanimated Screen, a graphic that has finished
 * entering, and a recovered Live Session alike.
 */
function graphicAnimationContext(
	graphic: BroadcastGraphicConfig,
	projections: readonly GraphicsAnimationProjection[],
	canvas: { width: number; height: number },
	/** Which rendering this context animates: the one arriving, or the one leaving. */
	half: 'incoming' | 'outgoing' = 'incoming',
	/**
	 * Which owners an update phase may animate, and whether the graphic is one of them.
	 *
	 * Absent outside an update phase, where every owner animates from its own recipe.
	 * Inside one it is the gate: an update recipe runs only where that owner's own
	 * rendered content changed, so this is what stops an item — or the whole composed
	 * graphic — moving for an input change that draws nothing.
	 */
	crossTransition?: GraphicsUpdateCrossTransition | null,
): {
	graphicMotion: readonly GraphicAnimationOwnerValues[];
	motionOf: GraphicsItemAnimationContext['motionOf'];
	itemContext: (item: GraphicItemConfig) => GraphicsItemAnimationContext;
} {
	if (projections.length === 0) {
		const resting: GraphicsItemAnimationContext = {
			phases: [],
			staggerOffsets: {},
			parent: canvas,
			motionOf: () => RESTING,
		};
		return { graphicMotion: RESTING, motionOf: () => RESTING, itemContext: () => resting };
	}

	const phases = projections.map(projection => projection.phase);
	const topLevelIds = graphic.items.map(item => item.id);

	// The two halves of a cross-transition are one projection read from both ends, so
	// selecting a half is all this does — it never projects the outgoing rendering
	// separately, and the two can therefore never fall out of step.
	//
	// Only an update has a second half, so every other concurrent phase resolves to the
	// Graphic Resting State on the outgoing rendering. That is right rather than lossy:
	// a phase running over an update moves both renderings together, so it belongs on
	// the element enclosing the pair and would be applied twice if it were also here.
	const halfOf = (values: GraphicAnimationValues): GraphicAnimationOwnerValues =>
		half === 'outgoing' ? values.outgoing ?? {} : values;

	/**
	 * An update recipe runs only where that owner's own rendered content changed. Outside
	 * an update phase there is nothing to gate: enter, exit, and on-screen are about the
	 * graphic's lifecycle rather than about its content.
	 */
	const animates = (ownerId: string | null, phase: GraphicAnimationPhase): boolean => {
		if (phase !== 'update')
			return true;
		if (!crossTransition)
			return false;
		// The graphic's own arm is redundant by construction rather than load-bearing:
		// `wholeGraphic` is false only when the graphic authored no update recipe, and an
		// owner with no recipe projects nothing anyway. It is stated because the invariant
		// is worth reading at the point that relies on it, not because removing it would
		// change a frame.
		return ownerId === null ? crossTransition.wholeGraphic : crossTransition.crossing.has(ownerId);
	};

	const motionOf: GraphicsItemAnimationContext['motionOf'] = (owner, staggerOffsets, parent) =>
		projections.map(({ phase, elapsed }) => animates(owner.id, phase)
			? halfOf(resolveGraphicAnimationValues({
					recipe: owner.animation?.[phase],
					phase,
					elapsed,
					staggerOffset: staggerOffsets[phase] ?? 0,
					rect: owner,
					parent,
				}))
			: {});

	return {
		graphicMotion: projections.map(({ phase, elapsed }) => animates(null, phase)
			? halfOf(resolveGraphicAnimationValues({
					recipe: graphic.animation?.[phase],
					phase,
					elapsed,
					// A whole-graphic recipe moves the composed frame, so its own bounds and
					// its parent are both the Screen canvas.
					rect: { x: 0, y: 0, ...canvas },
					parent: canvas,
				}))
			: {}),
		motionOf,
		itemContext: item => ({
			phases,
			staggerOffsets: staggerOffsetsFor(phases, graphic.animation, topLevelIds, item.id),
			parent: canvas,
			motionOf,
		}),
	};
}

/**
 * Separates a Graphic Group's children when their content is joined for comparison.
 *
 * A separator rather than a plain concatenation because the comparison has to be
 * exact: joining with nothing would make a group whose children read "ab" and "c"
 * indistinguishable from one reading "a" and "bc", and an update animation would be
 * skipped for a change that is plainly visible. A unit separator is used because a
 * Graphic Text Template can render any printable character an operator can type, so
 * any printable separator could be forged by the very content it is separating.
 */
const GROUP_CONTENT_SEPARATOR = '\u001F';

/**
 * What one owner renders from the current Graphic Input values, as a string that
 * changes exactly when its rendered content does.
 *
 * A Graphic Text Template reads Graphic Input and Social Profile values, while a
 * dynamic Social Network Icon reads its projection's network. A Graphic Group's
 * content is its children's. Shape and Media items render the same thing whatever
 * the accepted values are, which is why an update animation is not offered to them:
 * an update recipe runs when *that owner's* rendered content changes, and theirs did
 * not.
 *
 * The context-gated kinds answer the same way, and for a stronger reason than
 * "their content did not change": their content changes constantly, but from the
 * live Feature Match Session rather than from an acceptance. An update phase exists
 * to animate one atomically accepted set of Graphic Input changes, and only a host
 * that declares Graphic Inputs has acceptances at all — so the host that can carry
 * a ticking clock is exactly the host that never enters an update phase.
 */
function renderedContent(
	owner: GraphicItemConfig | GraphicGroupChildConfig,
	inputs: Pick<GraphicItemContentContext, 'declarations' | 'socialProfileValues' | 'values'>,
): string {
	if (owner.type === 'text') {
		return renderGraphicTextTemplate(owner.text, inputs.declarations, inputs.values, inputs.socialProfileValues)
			.map(segment => segment.text)
			.join('');
	}
	if (owner.type === 'social-network-icon') {
		return typeof owner.network === 'string'
			? owner.network
			: inputs.socialProfileValues?.[owner.network.projectionKey]?.network ?? '';
	}
	if (owner.type === 'group')
		return owner.children.map(child => renderedContent(child, inputs)).join(GROUP_CONTENT_SEPARATOR);
	return '';
}

/**
 * Which owners cross-transition, and whether the graphic itself is the one doing it.
 *
 * An update phase begins on any changed Graphic Input *value*, which is not the same
 * question as changed rendered *content* — a value no Text Graphic Item renders changes
 * nothing on screen. So every owner is asked about its own content, and an owner whose
 * content is unchanged is animated by nothing at all: there would be no old rendering
 * to cross it with, and running its update recipe anyway would dip or slide it on
 * program with no counterpart. That is `CONTEXT.md:545` for an item and `:546` for the
 * graphic, and the graphic's case is the one that would have been most visible — a
 * whole composed graphic dipping to half opacity and back for an input nothing draws.
 *
 * `wholeGraphic` decides *how* the pair is drawn as well as what. A whole-graphic
 * recipe moves the composed frame, so it needs two whole frames; anything else pairs
 * the two renderings inside each crossing item's own box, where Graphic Layer Order
 * still composes. The two are mutually exclusive, so neither has to reason about the
 * other's stacking.
 */
interface GraphicsUpdateCrossTransition {
	/** The Broadcast Graphic's own update recipe is what is cross-transitioning. */
	wholeGraphic: boolean;
	/** Owners whose own rendered content changed, so their update recipe may run. */
	crossing: Set<string>;
}

function updateCrossTransition(
	graphic: BroadcastGraphicConfig,
	current: GraphicItemContentContext,
	outgoing: GraphicItemContentContext,
): GraphicsUpdateCrossTransition | null {
	const changed = (owner: GraphicItemConfig | GraphicGroupChildConfig): boolean =>
		renderedContent(owner, current) !== renderedContent(owner, outgoing);

	if (!graphic.items.some(item => changed(item)))
		return null;

	const crossing = new Set<string>();
	for (const item of graphic.items) {
		if (item.animation?.update && changed(item))
			crossing.add(item.id);
		if (item.type !== 'group')
			continue;
		for (const child of item.children) {
			if (child.animation?.update && changed(child))
				crossing.add(child.id);
		}
	}

	// A Broadcast Graphic's update recipe runs when any of its rendered content changes,
	// and every item participates because the frame is what moves. An item's own update
	// recipe still applies inside each copy, gated by its own content as above.
	if (graphic.animation?.update)
		return { wholeGraphic: true, crossing };

	return crossing.size === 0 ? null : { wholeGraphic: false, crossing };
}

function safeAreaGuide(
	id: GraphicsSafeAreaGuideId,
	label: string,
	inset: number,
	canvasWidth: number,
	canvasHeight: number,
): GraphicsSafeAreaGuide {
	const insetX = Math.round(canvasWidth * inset);
	const insetY = Math.round(canvasHeight * inset);

	return {
		id,
		label,
		style: rectStyle({
			x: insetX,
			y: insetY,
			width: Math.max(0, canvasWidth - (insetX * 2)),
			height: Math.max(0, canvasHeight - (insetY * 2)),
		}),
	};
}

/**
 * Guides for the items an author can point at on the canvas: every top-level
 * Graphic Item, and the canvas-positioned children of a Graphic Group, whose
 * canvas rectangle is known without laying anything out. A row or column child's
 * rectangle is decided by the browser's own layout, so it is selected from the
 * authoring tree rather than from a guide the model would have to guess.
 */
function guideRects(graphic: BroadcastGraphicConfig): Array<{ itemId: string; label: string; rect: GraphicRect }> {
	return graphic.items.flatMap((item) => {
		const own = { itemId: item.id, label: item.label, rect: item as GraphicRect };
		if (item.type !== 'group' || item.arrangement !== 'canvas')
			return [own];

		const padding = Math.max(0, item.padding);
		return [
			own,
			...item.children.map(child => ({
				itemId: child.id,
				label: child.label,
				rect: { ...child, x: item.x + padding + child.x, y: item.y + padding + child.y },
			})),
		];
	});
}

export function resolveGraphicsCompositionRenderModel(
	input: GraphicsCompositionRenderModelInput,
): GraphicsCompositionRenderModel {
	const visible = input.visibleGraphicIds;
	const composed = visible
		? input.graphics.filter(graphic => visible.includes(graphic.id))
		: [...input.graphics];
	const selectedKey = input.selectedTarget ? graphicsSelectionKey(input.selectedTarget) : null;
	const selectedGraphicId = input.selectedTarget ? graphicsSelectionGraphicId(input.selectedTarget) : null;

	const isLayer = input.canvasRole === 'layer';

	// One value for both halves of "what can this output load, and what has it been
	// told it cannot", assembled once so every Media Graphic Item reads the same pair.
	const assetContent: GraphicAssetContentResolution | undefined = input.graphicAssetContentUrl
		? { url: input.graphicAssetContentUrl, refusal: input.graphicAssetContentRefusal }
		: undefined;

	return {
		output: input.output,
		canvasRole: isLayer ? 'layer' : 'screen-output',
		canvasStyle: {
			width: '100%',
			height: '100%',
			// A layer is placed and backed by its host. Painting either here would
			// override the host's own placement and cover everything beneath it.
			position: isLayer ? undefined : 'relative',
			overflow: 'hidden',
			background: isLayer ? 'transparent' : screenOutputCanvasBackground(input.output),
		},
		graphics: composed.map((graphic) => {
			// A host that supplies its own declarations supplies all of them: a
			// Feature Match Overlay's tokens are not a graphic's Graphic Inputs plus
			// extras, they are the whole vocabulary a template may name.
			const declarations = input.textDeclarations ?? graphic.inputs ?? [];
			const inputs: GraphicItemContentContext = {
				declarations,
				values: resolvedInputValues(
					declarations,
					input.inputValues?.[graphic.id],
					input.substituteAuthoredDefaults ?? false,
				),
				socialProfileValues: input.socialProfileValues?.[graphic.id],
				socialProfilePresentations: input.socialProfilePresentations?.[graphic.id],
				featureMatch: input.featureMatch,
			};
			const canvas = { width: input.canvasWidth, height: input.canvasHeight };
			const projections = input.animation?.[graphic.id] ?? [];
			const phases = projections.map(projection => projection.phase);

			// The rendering being replaced exists only inside an update phase, and only when
			// the Live Session supplied it. Anything else — an editor preview, a settled
			// graphic, an entrance — has one rendering and nothing to cross. An exit running
			// concurrently does not change that: the update is still crossing underneath it,
			// which is the whole point of projecting both.
			const outgoingValues = phases.includes('update')
				? input.outgoingInputValues?.[graphic.id]
				: undefined;
			const outgoingSocialProfileValues = phases.includes('update')
				? input.outgoingSocialProfileValues?.[graphic.id]
				: undefined;
			const outgoingInputs: GraphicItemContentContext = {
				declarations,
				// Substitution follows the same rule as the incoming rendering: the pair is
				// two renderings of one graphic, so an authored default standing in on one
				// side and not the other would make the transition itself the thing that
				// changes the value.
				values: resolvedInputValues(
					declarations,
					outgoingValues ?? input.inputValues?.[graphic.id],
					input.substituteAuthoredDefaults ?? false,
				),
				socialProfileValues: outgoingSocialProfileValues ?? input.socialProfileValues?.[graphic.id],
				socialProfilePresentations: input.socialProfilePresentations?.[graphic.id],
				featureMatch: input.featureMatch,
			};
			const crossTransition = outgoingValues !== undefined || outgoingSocialProfileValues !== undefined
				? updateCrossTransition(graphic, inputs, outgoingInputs)
				: null;
			const perItem = crossTransition !== null && !crossTransition.wholeGraphic;

			const { graphicMotion, itemContext } = graphicAnimationContext(
				graphic,
				projections,
				canvas,
				'incoming',
				crossTransition,
			);
			const outgoingHalf = crossTransition
				? graphicAnimationContext(graphic, projections, canvas, 'outgoing', crossTransition)
				: null;

			// Two whole frames means the graphic's own motion splits: what moves each frame
			// stays on that frame, and what moves both of them together goes on the element
			// they sit inside. With one frame there is nothing to split and the graphic's
			// element carries all of it, exactly as it did before concurrency existed.
			const wholeGraphicPair = crossTransition?.wholeGraphic === true && outgoingHalf !== null;
			const ownMotion = wholeGraphicPair ? crossingMotion(phases, graphicMotion) : graphicMotion;
			const style = motionStyle(ownMotion, canvas, 0, 'top-left');
			const enclosingStyle = enclosingMotionStyle(
				wholeGraphicPair ? enclosingMotion(phases, graphicMotion) : RESTING,
				ownMotion,
				canvas,
				'top-left',
			);

			const projectionByGroupId = new Map(
				(graphic.socialProfileProjections ?? []).map(projection => [
					projection.presentationGroupId,
					projection,
				]),
			);
			const buildItems = (
				values: GraphicItemContentContext,
				context: (item: GraphicItemConfig) => GraphicsItemAnimationContext,
				pairing: GraphicsItemAnimationContext['outgoing'],
			) => graphic.items
				.filter((item) => {
					if (!item.visible)
						return false;
					const projection = projectionByGroupId.get(item.id);
					if (!projection)
						return true;
					const presentation = values.socialProfilePresentations?.[projection.key];
					return presentation
						? presentation.layers.length > 0
						: values.socialProfileValues?.[projection.key] !== undefined;
				})
				.map((item) => {
					const projection = projectionByGroupId.get(item.id);
					const presentationFrame = projection && !phases.includes('update')
						? values.socialProfilePresentations?.[projection.key]
						: undefined;
					const presentation = projection && presentationFrame
						? { key: projection.key, frame: presentationFrame }
						: undefined;
					const currentValues = presentationFrame?.layers.at(-1)?.values;
					const itemValues = projection && currentValues
						? {
								...values,
								socialProfileValues: {
									...values.socialProfileValues,
									[projection.key]: currentValues,
								},
							}
						: values;
					return itemDescriptor(
						input.output,
						graphic.id,
						item,
						assetContent,
						itemValues,
						{
							...context(item),
							...(pairing === undefined
								? {}
								: { crossing: (ownerId: string) => crossTransition!.crossing.has(ownerId), outgoing: pairing }),
						},
						presentation,
					);
				});

			// Two whole frames only when the Broadcast Graphic's own recipe is what moves.
			// A per-item cross-transition pairs inside each crossing item's box instead, so
			// the two mechanisms never both apply to one graphic.
			let outgoing: BroadcastGraphicOutgoingRenderDescriptor | undefined;
			if (wholeGraphicPair && outgoingHalf) {
				const outgoingStyle = motionStyle(
					crossingMotion(phases, outgoingHalf.graphicMotion),
					canvas,
					0,
					'top-left',
				);
				outgoing = {
					...(Object.keys(outgoingStyle).length === 0 ? {} : { style: outgoingStyle }),
					items: buildItems(outgoingInputs, outgoingHalf.itemContext, undefined),
				};
			}

			return {
				id: graphic.id,
				name: graphic.name,
				// Omitted entirely at rest, so an unanimated Broadcast Graphic keeps the
				// descriptor it had before animation existed.
				...(Object.keys(style).length === 0 ? {} : { style }),
				...(enclosingStyle === undefined ? {} : { enclosingStyle }),
				items: buildItems(
					inputs,
					itemContext,
					perItem && outgoingHalf
						? { inputs: outgoingInputs, motionOf: outgoingHalf.motionOf }
						: undefined,
				),
				...(outgoing === undefined ? {} : { outgoing }),
			};
		}),
		safeAreaGuides: input.safeAreaGuides
			? [
					safeAreaGuide('action-safe', 'Action safe', GRAPHICS_ACTION_SAFE_INSET, input.canvasWidth, input.canvasHeight),
					safeAreaGuide('title-safe', 'Title safe', GRAPHICS_TITLE_SAFE_INSET, input.canvasWidth, input.canvasHeight),
				]
			: [],
		itemGuides: input.itemGuides
			? composed.flatMap(graphic => guideRects(graphic).map(guide => ({
					graphicId: graphic.id,
					itemId: guide.itemId,
					label: guide.label,
					selected: selectedKey === graphicsSelectionKey({ type: 'item', graphicId: graphic.id, itemId: guide.itemId }),
					inSelectedGraphic: selectedGraphicId === graphic.id,
					style: rectStyle(guide.rect),
				})))
			: [],
	};
}
