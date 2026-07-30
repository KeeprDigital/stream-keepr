import type { CSSProperties } from 'vue';
import type { MediaGraphicItemKind } from '~~/shared/types/graphicItem';
import type {
	BroadcastGraphicConfig,
	GraphicAnchorPoint,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicRect,
	GraphicSurfaceStyle,
	MediaGraphicItemConfig,
	ShapeGeometry,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from './selection';
import {
	isRectangularShapeGeometry,
	resolveGraphicAnchorPoint,
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
 * Getting this wrong is invisible in the Overlay Output and wrong on air, which
 * is why it is named, exported, and asserted rather than inlined.
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
	mediaKind: MediaGraphicItemKind;
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
	/** Present for Text Graphic Items. */
	text?: string;
	shrink?: GraphicTextShrinkBounds;
	/** Present for Media Graphic Items. */
	media?: GraphicMediaRenderDescriptor;
	/** Present for Graphic Groups: the group's direct children, back to front. */
	children?: GraphicItemRenderDescriptor[];
}

export interface BroadcastGraphicRenderDescriptor {
	id: string;
	name: string;
	items: GraphicItemRenderDescriptor[];
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

/** The bounds an item occupies on the canvas, plus rotation about its anchor. */
function canvasPlacement(item: GraphicItemConfig, offset: { x: number; y: number }): CSSProperties {
	const rotation = item.rotation ?? 0;
	return {
		...rectStyle({ ...item, x: item.x + offset.x, y: item.y + offset.y }),
		position: 'absolute',
		boxSizing: 'border-box',
		...(rotation === 0
			? {}
			: { transform: `rotate(${rotation}deg)`, transformOrigin: transformOrigin(item.anchor) }),
	};
}

/**
 * A row or column child's placement. Fixed sizing pins its main-axis extent;
 * weighted fill shares what remains. Graphic Rotation belongs to canvas
 * positioning, so a stacked child never rotates.
 */
function stackedPlacement(group: GraphicGroupItemConfig, child: GraphicGroupChildConfig): CSSProperties {
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

function textDescriptor(
	output: ScreenOutput,
	scope: string,
	item: TextGraphicItemConfig,
	placement: CSSProperties,
	surfaceStyle: GraphicSurfaceStyle | undefined,
): GraphicItemRenderDescriptor {
	return {
		id: item.id,
		label: item.label,
		kind: 'text',
		style: { ...placement, ...textBoxStyle(), filter: glowFilter(output, surfaceStyle) },
		surface: surfaceDescriptor(output, scope, item, squareShapeGeometry(), surfaceStyle),
		textStyle: graphicTextStyle(output, item),
		text: item.text,
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
 */
function mediaClip(item: MediaGraphicItemConfig): CSSProperties {
	if (!item.clipGeometry || isRectangularShapeGeometry(item.clipGeometry))
		return { overflow: 'hidden' };
	return {
		overflow: 'hidden',
		clipPath: `path('${shapeGeometryPath(item, item.clipGeometry)}')`,
	};
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
): GraphicItemRenderDescriptor {
	return {
		id: item.id,
		label: item.label,
		kind: 'media',
		style: { ...placement, ...mediaClip(item) },
		media: mediaDescriptor(output, item, resolveContentUrl),
	};
}

function childDescriptor(
	output: ScreenOutput,
	graphicId: string,
	group: GraphicGroupItemConfig,
	child: GraphicGroupChildConfig,
	resolveContentUrl: ((reference: GraphicAssetReference) => string) | undefined,
): GraphicItemRenderDescriptor {
	const placement = group.arrangement === 'canvas'
		? canvasPlacement(child, { x: Math.max(0, group.padding), y: Math.max(0, group.padding) })
		: stackedPlacement(group, child);
	const scope = elementScope(graphicId, child.id);

	// A Media Graphic Item carries no Graphic Surface Style, so it never inherits
	// its Graphic Group's local style default either: there is nothing on it for
	// that default to fill in.
	if (child.type === 'media')
		return mediaItemDescriptor(output, child, placement, resolveContentUrl);

	const surfaceStyle = resolveChildSurfaceStyle(group, child);

	if (child.type === 'text')
		return textDescriptor(output, scope, child, placement, surfaceStyle);

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
): GraphicItemRenderDescriptor {
	const placement = canvasPlacement(item, { x: 0, y: 0 });
	const scope = elementScope(graphicId, item.id);

	if (item.type === 'text')
		return textDescriptor(output, scope, item, placement, item.surfaceStyle);

	if (item.type === 'media')
		return mediaItemDescriptor(output, item, placement, resolveContentUrl);

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
			.map(child => childDescriptor(output, graphicId, item, child, resolveContentUrl)),
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
		graphics: composed.map(graphic => ({
			id: graphic.id,
			name: graphic.name,
			items: graphic.items
				.filter(item => item.visible)
				.map(item => itemDescriptor(input.output, graphic.id, item, input.graphicAssetContentUrl)),
		})),
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
