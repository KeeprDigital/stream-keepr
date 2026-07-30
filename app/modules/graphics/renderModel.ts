import type { CSSProperties } from 'vue';
import type { GraphicAnimationOwnerValues, GraphicAnimationValues, ShapeGeometrySize } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicAnchorPoint,
	GraphicAnimationPhase,
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
	ShapeGeometry,
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
 * an ordinary Screen Output URL carries none of the preview flags and so draws no
 * guides, but a URL that does carry them draws guides wherever it is opened,
 * including a browser used as a program source. Treat the flags as a convention
 * for editor embedding, not a guarantee about live output.
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
	 * Which lifecycle phase each Broadcast Graphic is in, and how long it has been
	 * there. A Broadcast Graphic absent from this map — or an omitted map — renders
	 * at its Graphic Resting State, which is what an unanimated Screen, a settled
	 * on-air graphic, and a recovered session all resolve to.
	 */
	animation?: Readonly<Record<string, GraphicsAnimationProjection>>;
	/**
	 * The accepted on-air Graphic Input values a Graphic Text Template renders,
	 * keyed by Broadcast Graphic id.
	 *
	 * Accepted values only: a Screen Output renders what an acceptance put on air,
	 * never a working value someone is still editing. A graphic with no entry — an
	 * editor preview, which has no Live Session to accept anything — renders its
	 * declared defaults, which is what a placed Broadcast Graphic starts from.
	 */
	inputValues?: Readonly<Record<string, Readonly<Record<string, GraphicInputValue>>>>;
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
	 */
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
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
	/** Present for Graphic Groups: the group's direct children, back to front. */
	children?: GraphicItemRenderDescriptor[];
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
 * The rendering an update phase is leaving behind, drawn beside the one arriving.
 *
 * A second copy of the same item tree rather than a second set of styles on the
 * first, because the two renderings differ in *content*: an update cross-transitions
 * old and new text passing each other, and one element cannot hold two strings.
 *
 * The tree is structurally identical to `items`, which is load-bearing for a row or
 * column Graphic Group: both copies lay out the same boxes in the same order, so the
 * outgoing content sits exactly where the incoming content will. Owners that are not
 * part of the cross-transition keep their box and paint nothing at all, so unchanged
 * content is still drawn exactly once and cannot double its own alpha.
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
function surfaceDescriptor(
	output: ScreenOutput,
	scope: string,
	size: { width: number; height: number },
	geometry: ShapeGeometry,
	style: GraphicSurfaceStyle | undefined,
): GraphicSurfaceRenderDescriptor | undefined {
	if (!style)
		return undefined;

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
 */
function motionStyle(
	values: GraphicAnimationOwnerValues,
	size: { width: number; height: number },
	rotation: number,
	anchor: GraphicAnchorPoint | undefined,
): CSSProperties {
	const parts: string[] = [];
	const translate = values.translate;

	if (translate && (translate.x !== 0 || translate.y !== 0))
		parts.push(`translate(${motionValue(translate.x)}px, ${motionValue(translate.y)}px)`);

	if (rotation !== 0)
		parts.push(`rotate(${rotation}deg)`);

	if (values.scale !== undefined) {
		const scale = values.scale;
		const origin = values.scaleOrigin ?? resolveGraphicAnimationOrigin(undefined);
		const anchorPoint = resolveGraphicAnchorPoint(anchor);
		const shiftX = (origin.x - anchorPoint.x) * size.width * (1 - scale);
		const shiftY = (origin.y - anchorPoint.y) * size.height * (1 - scale);
		if (shiftX !== 0 || shiftY !== 0)
			parts.push(`translate(${motionValue(shiftX)}px, ${motionValue(shiftY)}px)`);
		parts.push(`scale(${motionValue(scale)})`);
	}

	const mask = revealMask(values);

	return {
		...(parts.length === 0 ? {} : { transform: parts.join(' '), transformOrigin: transformOrigin(anchor) }),
		...(values.opacity === undefined ? {} : { opacity: motionValue(values.opacity) }),
		...(mask === undefined ? {} : { maskImage: mask }),
	};
}

const RESTING: GraphicAnimationOwnerValues = {};

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
export function graphicTextStyle(
	output: ScreenOutput,
	item: TextGraphicItemConfig,
	fontSize = item.typography.fontSize,
): CSSProperties {
	const typography = item.typography;
	const base: CSSProperties = {
		margin: 0,
		width: '100%',
		color: paintColour(output, typography.color),
		fontFamily: resolveGraphicFontFamily(typography.fontId),
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
	motion: GraphicAnimationOwnerValues,
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
	motion: GraphicAnimationOwnerValues,
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
	child: Exclude<GraphicGroupChildConfig, MediaGraphicItemConfig>,
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
	if (style.fontId !== undefined)
		resolved.fontFamily = resolveGraphicFontFamily(style.fontId);
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
 * Declared defaults first, then whatever acceptance has put on air. That layering
 * is what makes an editor preview show the design as authored while a live output
 * shows the show as taken, from one code path.
 */
function resolvedInputValues(
	declarations: readonly GraphicInputDeclaration[],
	accepted: Readonly<Record<string, GraphicInputValue>> | undefined,
): Record<string, GraphicInputValue> {
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
	inputs: GraphicTextTemplateContext,
): GraphicItemRenderDescriptor {
	const segments = renderGraphicTextTemplate(item.text, inputs.declarations, inputs.values)
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
 * One Media Graphic Item's element paint.
 *
 * Focal position is where `objectPosition` puts the asset inside the box, which
 * is what decides which part of a `cover` fit survives the crop. In the Key
 * Output the element is filtered to white at its own alpha; see
 * `KEY_MEDIA_ALPHA_TO_WHITE`.
 */
function mediaDescriptor(
	output: ScreenOutput,
	item: MediaGraphicItemConfig,
	resolveContentUrl: ((reference: GraphicAssetReference) => string) | undefined,
): GraphicMediaRenderDescriptor {
	return {
		mediaKind: item.mediaKind,
		src: item.asset && resolveContentUrl ? resolveContentUrl(item.asset) : '',
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
		videoCompatibility: item.videoCompatibility,
	};
}

function mediaItemDescriptor(
	output: ScreenOutput,
	item: MediaGraphicItemConfig,
	placement: CSSProperties,
	resolveContentUrl: ((reference: GraphicAssetReference) => string) | undefined,
	clipSize: ShapeGeometrySize | undefined,
): GraphicItemRenderDescriptor {
	return {
		id: item.id,
		label: item.label,
		kind: 'media',
		style: { ...placement, ...mediaClip(item, clipSize) },
		media: mediaDescriptor(output, item, resolveContentUrl),
	};
}

/** What one Broadcast Graphic's Graphic Text Templates resolve their placeholders from. */
interface GraphicTextTemplateContext {
	declarations: readonly GraphicInputDeclaration[];
	values: Readonly<Record<string, GraphicInputValue>>;
}

function childDescriptor(
	output: ScreenOutput,
	graphicId: string,
	group: GraphicGroupItemConfig,
	child: GraphicGroupChildConfig,
	resolveContentUrl: ((reference: GraphicAssetReference) => string) | undefined,
	inputs: GraphicTextTemplateContext,
	motion: GraphicAnimationOwnerValues,
): GraphicItemRenderDescriptor {
	const placement = group.arrangement === 'canvas'
		? canvasPlacement(child, { x: Math.max(0, group.padding), y: Math.max(0, group.padding) }, motion)
		: stackedPlacement(group, child, motion);
	const scope = elementScope(graphicId, child.id);

	// A Media Graphic Item carries no Graphic Surface Style, so it never inherits
	// its Graphic Group's local style default either: there is nothing on it for
	// that default to fill in.
	if (child.type === 'media')
		return mediaItemDescriptor(output, child, placement, resolveContentUrl, stackedChildClipSize(group, child));

	const surfaceStyle = resolveChildSurfaceStyle(group, child);

	if (child.type === 'text')
		return textDescriptor(output, scope, child, placement, surfaceStyle, inputs);

	return {
		id: child.id,
		label: child.label,
		kind: 'shape',
		style: { ...placement, filter: glowFilter(output, surfaceStyle) },
		surface: surfaceDescriptor(output, scope, child, child.geometry, surfaceStyle),
	};
}

function itemDescriptor(
	output: ScreenOutput,
	graphicId: string,
	item: GraphicItemConfig,
	resolveContentUrl: ((reference: GraphicAssetReference) => string) | undefined,
	inputs: GraphicTextTemplateContext,
	context: GraphicsItemAnimationContext,
): GraphicItemRenderDescriptor {
	const motion = context.motionOf(item, context.staggerOffset, context.parent);
	const placement = canvasPlacement(item, { x: 0, y: 0 }, motion);
	const scope = elementScope(graphicId, item.id);

	if (item.type === 'text')
		return textDescriptor(output, scope, item, placement, item.surfaceStyle, inputs);

	// A top-level Graphic Item always occupies its authored rectangle.
	if (item.type === 'media')
		return mediaItemDescriptor(output, item, placement, resolveContentUrl, item);

	if (item.type === 'shape') {
		return {
			id: item.id,
			label: item.label,
			kind: 'shape',
			style: { ...placement, filter: glowFilter(output, item.surfaceStyle) },
			surface: surfaceDescriptor(output, scope, item, item.geometry, item.surfaceStyle),
		};
	}

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
			.map(child => childDescriptor(
				output,
				graphicId,
				item,
				child,
				resolveContentUrl,
				inputs,
				// A child's own delay is offset by its group's stagger, on top of
				// whatever offset the group itself received: both are measured from the
				// one shared phase start. A `clear-parent` slide clears the group, not
				// the canvas, because the group is the child's parent.
				context.motionOf(
					child,
					context.staggerOffset + graphicAnimationStaggerOffset(
						item.animation?.stagger?.[context.phase],
						item.children.map(entry => entry.id),
						child.id,
					),
					item,
				),
			)),
	};
}

/**
 * How one Broadcast Graphic's items find their own motion.
 *
 * Bundled rather than passed as five arguments because every owner needs the same
 * phase, the same elapsed time, and the same canvas, and only the stagger offset
 * and the parent bounds differ between them.
 */
interface GraphicsItemAnimationContext {
	phase: GraphicAnimationPhase;
	/** The offset this item's own container added to its delay. */
	staggerOffset: number;
	/** The bounds a `clear-parent` slide has to leave. */
	parent: { width: number; height: number };
	motionOf: (
		owner: GraphicItemConfig | GraphicGroupChildConfig,
		staggerOffset: number,
		parent: { width: number; height: number },
	) => GraphicAnimationOwnerValues;
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
	projection: GraphicsAnimationProjection | undefined,
	canvas: { width: number; height: number },
	/** Which rendering this context animates: the one arriving, or the one leaving. */
	half: 'incoming' | 'outgoing' = 'incoming',
): { graphicMotion: GraphicAnimationOwnerValues; itemContext: (item: GraphicItemConfig) => GraphicsItemAnimationContext } {
	if (!projection) {
		const resting: GraphicsItemAnimationContext = {
			phase: 'enter',
			staggerOffset: 0,
			parent: canvas,
			motionOf: () => RESTING,
		};
		return { graphicMotion: RESTING, itemContext: () => resting };
	}

	const { phase, elapsed } = projection;
	const topLevelIds = graphic.items.map(item => item.id);
	const graphicStagger = graphic.animation?.stagger?.[phase];

	// The two halves of a cross-transition are one projection read from both ends, so
	// selecting a half is all this does — it never projects the outgoing rendering
	// separately, and the two can therefore never fall out of step.
	const halfOf = (values: GraphicAnimationValues): GraphicAnimationOwnerValues =>
		half === 'outgoing' ? values.outgoing ?? RESTING : values;

	const motionOf: GraphicsItemAnimationContext['motionOf'] = (owner, staggerOffset, parent) =>
		halfOf(resolveGraphicAnimationValues({
			recipe: owner.animation?.[phase],
			phase,
			elapsed,
			staggerOffset,
			rect: owner,
			parent,
		}));

	return {
		graphicMotion: halfOf(resolveGraphicAnimationValues({
			recipe: graphic.animation?.[phase],
			phase,
			elapsed,
			// A whole-graphic recipe moves the composed frame, so its own bounds and
			// its parent are both the Screen canvas.
			rect: { x: 0, y: 0, ...canvas },
			parent: canvas,
		})),
		itemContext: item => ({
			phase,
			staggerOffset: graphicAnimationStaggerOffset(graphicStagger, topLevelIds, item.id),
			parent: canvas,
			motionOf,
		}),
	};
}

/**
 * What one owner renders from the current Graphic Input values, as a string that
 * changes exactly when its rendered content does.
 *
 * Only a Graphic Text Template reads Graphic Input values today, so only a Text
 * Graphic Item's content can change under a graphic that is already on air — and a
 * Graphic Group's content is its children's. A Shape or Media Graphic Item renders
 * the same thing whatever the values are, which is why an update animation is not
 * offered to it here: an update recipe runs when *that owner's* rendered content
 * changes, and its content did not.
 */
function renderedContent(
	owner: GraphicItemConfig | GraphicGroupChildConfig,
	declarations: readonly GraphicInputDeclaration[],
	values: Readonly<Record<string, GraphicInputValue>>,
): string {
	if (owner.type === 'text')
		return renderGraphicTextTemplate(owner.text, declarations, values).map(segment => segment.text).join('');
	if (owner.type === 'group')
		return owner.children.map(child => renderedContent(child, declarations, values)).join(' ');
	return '';
}

/**
 * Which owners cross-transition, and which merely contain one that does.
 *
 * The two sets exist to stop unchanged content being painted twice. Drawing the whole
 * graphic again would double every element's contribution to the composed frame, and
 * for anything less than fully opaque that is visible: two copies of a
 * three-quarter-opaque panel composite to fifteen sixteenths, so a panel that is
 * supposed to hold still would brighten for the length of every update.
 *
 * A whole-graphic update recipe is the case where drawing everything twice is exactly
 * what the author asked for — the whole old graphic leaves as the whole new one
 * arrives, unchanged parts included, and the cross-fade dip through the middle is the
 * effect rather than a defect. Otherwise only the owners whose own content changed
 * cross-transition, and everything else keeps its box in the outgoing copy so the
 * layout matches, while painting nothing.
 */
interface GraphicsUpdateCrossTransition {
	/** Owners drawn in full in both copies, each half of the recipe applied to one. */
	crossing: Set<string>;
	/** Owners kept in the outgoing copy only because something inside them crosses. */
	containing: Set<string>;
}

function updateCrossTransition(
	graphic: BroadcastGraphicConfig,
	declarations: readonly GraphicInputDeclaration[],
	current: Readonly<Record<string, GraphicInputValue>>,
	outgoing: Readonly<Record<string, GraphicInputValue>>,
): GraphicsUpdateCrossTransition | null {
	const changed = (owner: GraphicItemConfig | GraphicGroupChildConfig): boolean =>
		renderedContent(owner, declarations, current) !== renderedContent(owner, declarations, outgoing);

	if (!graphic.items.some(item => changed(item)))
		return null;

	// A Broadcast Graphic's update recipe runs when any of its rendered content
	// changes, and it moves the whole composed graphic — so every owner is part of it.
	if (graphic.animation?.update) {
		const crossing = new Set<string>();
		for (const item of graphic.items) {
			crossing.add(item.id);
			if (item.type === 'group')
				item.children.forEach(child => crossing.add(child.id));
		}
		return { crossing, containing: new Set() };
	}

	const crossing = new Set<string>();
	const containing = new Set<string>();

	for (const item of graphic.items) {
		if (item.animation?.update && changed(item)) {
			crossing.add(item.id);
			if (item.type === 'group')
				item.children.forEach(child => crossing.add(child.id));
			continue;
		}

		if (item.type !== 'group')
			continue;

		const crossingChildren = item.children.filter(child => child.animation?.update && changed(child));
		if (crossingChildren.length === 0)
			continue;

		containing.add(item.id);
		crossingChildren.forEach(child => crossing.add(child.id));
	}

	return crossing.size === 0 ? null : { crossing, containing };
}

/**
 * One item of the outgoing copy, reduced to what it is allowed to paint.
 *
 * An owner that crosses is left exactly as built. One that only contains a crosser
 * keeps its box and its children but loses its own Graphic Surface Style, because that
 * surface is already being painted by the incoming copy and painting it again is the
 * double-alpha this exists to prevent. Anything else keeps only its box, so a row or
 * column Graphic Group lays both copies out identically.
 */
function outgoingItem(
	item: GraphicItemRenderDescriptor,
	crossTransition: GraphicsUpdateCrossTransition,
): GraphicItemRenderDescriptor {
	if (crossTransition.crossing.has(item.id))
		return item;

	if (crossTransition.containing.has(item.id)) {
		return {
			id: item.id,
			label: item.label,
			kind: item.kind,
			style: { ...item.style, filter: undefined },
			children: item.children?.map(child => outgoingItem(child, crossTransition)),
		};
	}

	return {
		id: item.id,
		label: item.label,
		kind: item.kind,
		style: { ...item.style, filter: undefined, visibility: 'hidden' },
	};
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

	return {
		output: input.output,
		canvasStyle: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			background: screenOutputCanvasBackground(input.output),
		},
		graphics: composed.map((graphic) => {
			const declarations = graphic.inputs ?? [];
			const inputs: GraphicTextTemplateContext = {
				declarations,
				values: resolvedInputValues(declarations, input.inputValues?.[graphic.id]),
			};
			const canvas = { width: input.canvasWidth, height: input.canvasHeight };
			const projection = input.animation?.[graphic.id];
			const { graphicMotion, itemContext } = graphicAnimationContext(graphic, projection, canvas);
			const style = motionStyle(graphicMotion, canvas, 0, 'top-left');

			const buildItems = (
				values: GraphicTextTemplateContext,
				context: (item: GraphicItemConfig) => GraphicsItemAnimationContext,
			) => graphic.items
				.filter(item => item.visible)
				.map(item => itemDescriptor(
					input.output,
					graphic.id,
					item,
					input.graphicAssetContentUrl,
					values,
					context(item),
				));

			// The outgoing rendering exists only inside an update phase, and only when the
			// Live Session supplied the rendering being left behind. Anything else — an
			// editor preview, a settled graphic, an entrance — has one rendering.
			const outgoingValues = projection?.phase === 'update'
				? input.outgoingInputValues?.[graphic.id]
				: undefined;
			const crossTransition = outgoingValues
				? updateCrossTransition(graphic, declarations, inputs.values, resolvedInputValues(declarations, outgoingValues))
				: null;

			let outgoing: BroadcastGraphicOutgoingRenderDescriptor | undefined;
			if (outgoingValues && crossTransition) {
				const half = graphicAnimationContext(graphic, projection, canvas, 'outgoing');
				const outgoingStyle = motionStyle(half.graphicMotion, canvas, 0, 'top-left');
				outgoing = {
					...(Object.keys(outgoingStyle).length === 0 ? {} : { style: outgoingStyle }),
					items: buildItems(
						{ declarations, values: resolvedInputValues(declarations, outgoingValues) },
						half.itemContext,
					).map(item => outgoingItem(item, crossTransition)),
				};
			}

			return {
				id: graphic.id,
				name: graphic.name,
				// Omitted entirely at rest, so an unanimated Broadcast Graphic keeps the
				// descriptor it had before animation existed.
				...(Object.keys(style).length === 0 ? {} : { style }),
				items: buildItems(inputs, itemContext),
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
