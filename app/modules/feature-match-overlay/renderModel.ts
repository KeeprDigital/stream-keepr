import type { CSSProperties } from 'vue';
import type { ThemeSurfaceStyle } from '~~/shared/modules/theme';
import type {
	FeatureMatchOverlayFrameConfig,
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayOutput,
	FeatureMatchOverlayRect,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
import type { GraphicFillDescriptor } from '~/modules/graphics/renderModel';
import type { FeatureMatchOverlayBorderSide } from '~/utils/featureMatchOverlayGeometry';
import { screenOutputCanvasBackground } from '~~/shared/utils/screenOutput';
import { fillDescriptor } from '~/modules/graphics/renderModel';
import { clampOpacity, colourAtOpacity, glowDropShadow, glowFlood, paintColour } from '~/modules/screen/outputPaint';
import {
	FEATURE_MATCH_OVERLAY_BORDER_SIDES,
	featureMatchOverlayBorderRadiusCss,
	featureMatchOverlayBorderSideEnabled,
	featureMatchOverlaySourceCutoutRect,
	resolveFeatureMatchOverlayCornerRadii,
	roundedRectPath,
} from '~/utils/featureMatchOverlayGeometry';

/**
 * The host-owned half of a Feature Match Overlay's rendering: the Frame and the
 * Source Items.
 *
 * Everything else a Feature Match Layout draws is the shared item tree, resolved
 * by the shared compositor through `compositorRenderModel.ts`. This model is what
 * is left once the legacy widget vocabulary is gone: a continuous graphic area,
 * the external video source areas placed against it, and the cutouts they punch
 * through it.
 */

export type { FeatureMatchOverlayBorderSide };

/** A resolved surface Mode Token: every colour a literal. */
export type FeatureMatchOverlaySurface = ThemeSurfaceStyle<string>;

/** What the Frame and Source Items paint from the Screen's resolved Mode Tokens (#831). */
export interface FeatureMatchOverlayThemeSurfaces {
	frameSurface: FeatureMatchOverlaySurface;
	sourceSurface: FeatureMatchOverlaySurface;
}

export interface FeatureMatchOverlayRenderModelInput {
	config: FeatureMatchOverlayModeConfig;
	output: FeatureMatchOverlayOutput;
	/** The Frame's and Source Items' resolved surfaces. */
	surfaces: FeatureMatchOverlayThemeSurfaces;
	/**
	 * Whether the Frame paints media or an Animation Effect over its fill: its own
	 * image or video, its Theme's media, or its effect. The Key Output keys those
	 * through an opaque white fill, since it paints no colour of theirs.
	 */
	paintsMedia?: boolean;
	maskId?: string;
	/** The document-unique id of the SVG filter that glows the Frame's border. */
	frameGlowFilterId?: string;
}

/** The Frame's border glow, as the SVG `feDropShadow` its border group filters through. */
export interface FeatureMatchOverlayFrameGlowRenderModel {
	filterId: string;
	stdDeviation: number;
	floodColor: string;
	floodOpacity: number;
}

/** The Frame's border: one stroke along each enabled canvas edge. */
export interface FeatureMatchOverlayFrameBorderRenderModel {
	stroke: string;
	strokeWidth: number;
	sides: FeatureMatchOverlayBorderSide[];
	glow: FeatureMatchOverlayFrameGlowRenderModel | undefined;
}

export interface FeatureMatchOverlayFrameRenderModel {
	maskId: string;
	/** The Key Output keys an image through the white fill beneath it, never its colours. */
	paintsImage: boolean;
	imageStyle: CSSProperties;
	imagePreserveAspectRatio: string;
	/** The `frame-surface` fill: a colour, or `url(#id)` with the gradient to define. */
	fill: GraphicFillDescriptor;
	opacity: number;
	border: FeatureMatchOverlayFrameBorderRenderModel | undefined;
}

export interface FeatureMatchOverlaySourceItemRenderModel {
	item: FeatureMatchSourceItemConfig;
	style: CSSProperties;
	glowContainerStyle?: CSSProperties;
	glowStyle?: CSSProperties;
	cutoutPath: string | null;
}

export interface FeatureMatchOverlayRenderModel {
	output: FeatureMatchOverlayOutput;
	canvasStyle: CSSProperties;
	sourceItems: FeatureMatchOverlaySourceItemRenderModel[];
	sourceCutouts: Array<{ id: string; path: string }>;
	frame: FeatureMatchOverlayFrameRenderModel;
	rectStyle: (rect: FeatureMatchOverlayRect) => CSSProperties;
}

/**
 * A CSS alpha mask for HTML content embedded in the Frame SVG.
 *
 * Chromium can promote a canvas or video inside an SVG `foreignObject` to its
 * own composited layer and let that layer escape a mask attached to the
 * `foreignObject` itself. vMix's embedded Chromium exhibits that behaviour for
 * Animation Effects. A self-contained SVG image used as a CSS mask keeps the
 * clipping in the HTML compositing path while deriving the exact same rounded
 * cutouts as the Frame's native SVG layers.
 */
export function featureMatchOverlayFrameContentMaskStyle(
	canvasWidth: number,
	canvasHeight: number,
	cutoutPaths: readonly string[],
): CSSProperties {
	const width = Math.max(0, canvasWidth);
	const height = Math.max(0, canvasHeight);
	const compoundPath = [
		`M 0 0 H ${width} V ${height} H 0 Z`,
		...cutoutPaths,
	].join(' ');
	const svg = [
		'<svg xmlns="http://www.w3.org/2000/svg"',
		` viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
		`<path d="${compoundPath}" fill="white" fill-rule="evenodd"/>`,
		'</svg>',
	].join('');
	const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

	return {
		maskImage,
		maskRepeat: 'no-repeat',
		maskSize: '100% 100%',
		WebkitMaskImage: maskImage,
		WebkitMaskRepeat: 'no-repeat',
		WebkitMaskSize: '100% 100%',
	};
}

function rectStyle(rect: FeatureMatchOverlayRect): CSSProperties {
	return {
		left: `${rect.x}px`,
		top: `${rect.y}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	};
}

/**
 * A surface's fill as one CSS background. A gradient's stops keep their own
 * opacities, multiplied by the fill's; the Key Output paints each white at its
 * colour's alpha, so it keys as the Fill Output shows it.
 */
function cssFill(output: FeatureMatchOverlayOutput, surface: FeatureMatchOverlaySurface): string {
	const opacity = clampOpacity(surface.fillOpacity);
	if (opacity <= 0)
		return 'transparent';
	const { fill } = surface;
	if (fill.type === 'solid')
		return colourAtOpacity(output, fill.color, opacity);
	const stops = fill.stops.map(stop =>
		`${colourAtOpacity(output, stop.color, clampOpacity(stop.opacity) * opacity)} ${Math.round(clampOpacity(stop.position) * 10000) / 100}%`);
	return `linear-gradient(${fill.angle}deg, ${stops.join(', ')})`;
}

/** A surface's outline, which a Frame or Source Item draws as its border; none at zero width. */
function surfaceOutline(surface: FeatureMatchOverlaySurface) {
	return surface.outline && surface.outline.width > 0
		? surface.outline
		: undefined;
}

function sourceGlowMaskStyle(
	item: FeatureMatchSourceItemConfig,
	extent: number,
	position: 'inside' | 'outside',
): CSSProperties {
	const width = Math.max(0, item.width);
	const height = Math.max(0, item.height);
	const maskWidth = width + (extent * 2);
	const maskHeight = height + (extent * 2);
	const innerPath = roundedRectPath({
		x: extent,
		y: extent,
		width,
		height,
		radii: resolveFeatureMatchOverlayCornerRadii(item.framingStyle ?? {}),
	});
	const path = position === 'inside'
		? innerPath
		: `M 0 0 H ${maskWidth} V ${maskHeight} H 0 Z ${innerPath}`;
	const svg = [
		'<svg xmlns="http://www.w3.org/2000/svg"',
		` viewBox="0 0 ${maskWidth} ${maskHeight}" preserveAspectRatio="none">`,
		`<path d="${path}" fill="white" fill-rule="evenodd"/>`,
		'</svg>',
	].join('');
	const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

	return {
		maskImage,
		maskRepeat: 'no-repeat',
		maskSize: '100% 100%',
		WebkitMaskImage: maskImage,
		WebkitMaskRepeat: 'no-repeat',
		WebkitMaskSize: '100% 100%',
	};
}

function sourceGlowStyles(
	output: FeatureMatchOverlayOutput,
	item: FeatureMatchSourceItemConfig,
	surface: FeatureMatchOverlaySurface,
): Pick<FeatureMatchOverlaySourceItemRenderModel, 'glowContainerStyle' | 'glowStyle'> | undefined {
	// A Source Item glows its border, so it has no glow without one.
	const filter = glowDropShadow(output, surface.glow);
	if (!surfaceOutline(surface) || !surface.glow || !filter)
		return undefined;
	const style = item.framingStyle ?? {};

	const visibleSides = FEATURE_MATCH_OVERLAY_BORDER_SIDES.filter(side => featureMatchOverlayBorderSideEnabled(style, side));
	if (visibleSides.length === 0)
		return undefined;

	const size = surface.glow.size;
	// A CSS drop-shadow extends beyond the element it filters. Give that result a
	// larger local canvas so the mask can retain either half without clipping its
	// soft tail. Three blur radii cover Chromium's rendered filter region.
	const extent = Math.max(1, Math.ceil(size * 3));
	const position = style.glowPosition ?? 'both';
	return {
		glowContainerStyle: {
			position: 'absolute',
			left: `${item.x - extent}px`,
			top: `${item.y - extent}px`,
			width: `${Math.max(0, item.width) + (extent * 2)}px`,
			height: `${Math.max(0, item.height) + (extent * 2)}px`,
			overflow: 'hidden',
			pointerEvents: 'none',
			...(position === 'both'
				? {}
				: sourceGlowMaskStyle(item, extent, position)),
		},
		glowStyle: {
			position: 'absolute',
			left: `${extent}px`,
			top: `${extent}px`,
			width: `${Math.max(0, item.width)}px`,
			height: `${Math.max(0, item.height)}px`,
			boxSizing: 'border-box',
			background: 'transparent',
			// CSS drop-shadow includes its source in the filtered result. The real
			// Source Item covers this duplicate border, which matches it exactly so
			// rounded-edge antialiasing leaves no visible subpixels.
			...cssBorderStyle(output, style, surface),
			borderRadius: featureMatchOverlayBorderRadiusCss(style),
			filter,
			pointerEvents: 'none',
		},
	};
}

function cssBorderStyle(
	output: FeatureMatchOverlayOutput,
	style: FeatureMatchSourceFramingStyle,
	surface: FeatureMatchOverlaySurface,
) {
	const outline = surfaceOutline(surface);
	const border = outline
		? `${outline.width}px solid ${paintColour(output, outline.color)}`
		: 'none';
	return {
		border: 'none',
		borderTop: featureMatchOverlayBorderSideEnabled(style, 'Top')
			? border
			: 'none',
		borderRight: featureMatchOverlayBorderSideEnabled(style, 'Right')
			? border
			: 'none',
		borderBottom: featureMatchOverlayBorderSideEnabled(style, 'Bottom')
			? border
			: 'none',
		borderLeft: featureMatchOverlayBorderSideEnabled(style, 'Left')
			? border
			: 'none',
	};
}

/** One canvas edge of the Frame's border as an SVG line, in canvas coordinates. */
export function frameBorderLine(side: FeatureMatchOverlayBorderSide, width: number, height: number) {
	switch (side) {
		case 'Top':
			return { x1: 0, y1: 0, x2: width, y2: 0 };
		case 'Right':
			return {
				x1: width,
				y1: 0,
				x2: width,
				y2: height,
			};
		case 'Bottom':
			return {
				x1: 0,
				y1: height,
				x2: width,
				y2: height,
			};
		case 'Left':
			return { x1: 0, y1: 0, x2: 0, y2: height };
	}
}

function frameImagePreserveAspectRatio(fit: FeatureMatchOverlayModeConfig['layout']['frame']['backgroundImageFit']) {
	switch (fit) {
		case 'contain':
			return 'xMidYMid meet';
		case 'fill':
			return 'none';
		case 'cover':
		default:
			return 'xMidYMid slice';
	}
}

/**
 * The Frame's border, or none: its surface's outline along each enabled
 * canvas edge. Its glow is a shadow of that stroke, so it has no glow without
 * one, in any output.
 */
function frameBorder(
	output: FeatureMatchOverlayOutput,
	frame: FeatureMatchOverlayFrameConfig,
	surface: FeatureMatchOverlaySurface,
	glowFilterId: string,
): FeatureMatchOverlayFrameBorderRenderModel | undefined {
	const outline = surfaceOutline(surface);
	if (!outline)
		return undefined;

	const flood = glowFlood(output, surface.glow);
	return {
		stroke: paintColour(output, outline.color),
		strokeWidth: outline.width,
		sides: FEATURE_MATCH_OVERLAY_BORDER_SIDES.filter(side => featureMatchOverlayBorderSideEnabled(frame, side)),
		glow: flood && { filterId: glowFilterId, ...flood },
	};
}

/** The Frame's fill, keyed opaque where it carries media the Key Output paints no colour of. */
function frameFill(
	output: FeatureMatchOverlayOutput,
	surface: FeatureMatchOverlaySurface,
	paintsMedia: boolean,
	scope: string,
): GraphicFillDescriptor {
	if (output === 'key' && paintsMedia) {
		return {
			color: paintColour(output, '#ffffff'),
			opacity: 1,
		};
	}
	return fillDescriptor(output, surface, scope);
}

function frameRenderModel(
	output: FeatureMatchOverlayOutput,
	frame: FeatureMatchOverlayFrameConfig,
	surface: FeatureMatchOverlaySurface,
	paintsMedia: boolean,
	ids: { maskId: string; glowFilterId: string },
): FeatureMatchOverlayFrameRenderModel {
	return {
		maskId: ids.maskId,
		paintsImage: output !== 'key',
		imageStyle: { opacity: frame.opacity },
		imagePreserveAspectRatio: frameImagePreserveAspectRatio(frame.backgroundImageFit),
		fill: frameFill(output, surface, paintsMedia, ids.maskId),
		opacity: frame.opacity,
		border: frameBorder(output, frame, surface, ids.glowFilterId),
	};
}

function sourceItemStyle(
	output: FeatureMatchOverlayOutput,
	item: FeatureMatchSourceItemConfig,
	surface: FeatureMatchOverlaySurface,
): CSSProperties {
	const style = item.framingStyle ?? {};
	return {
		...rectStyle(item),
		position: 'absolute',
		boxSizing: 'border-box',
		background: cssFill(output, surface),
		...cssBorderStyle(output, style, surface),
		borderRadius: featureMatchOverlayBorderRadiusCss(style),
		overflow: 'hidden',
		pointerEvents: 'none',
	};
}

export function resolveFeatureMatchOverlayRenderModel(
	input: FeatureMatchOverlayRenderModelInput,
): FeatureMatchOverlayRenderModel {
	const { output, config, surfaces } = input;
	const sourceItems = config.layout.sources
		.filter(item => item.visible)
		.map((item) => {
			const glow = sourceGlowStyles(output, item, surfaces.sourceSurface);
			return {
				item,
				style: sourceItemStyle(output, item, surfaces.sourceSurface),
				...glow,
				cutoutPath: item.frameCutout
					? roundedRectPath(featureMatchOverlaySourceCutoutRect(item, surfaceOutline(surfaces.sourceSurface)?.width)) || null
					: null,
			};
		});

	return {
		output,
		canvasStyle: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			background: screenOutputCanvasBackground(output),
		},
		sourceItems,
		sourceCutouts: sourceItems
			.filter(source => source.cutoutPath)
			.map(source => ({ id: source.item.id, path: source.cutoutPath! })),
		frame: frameRenderModel(output, config.layout.frame, surfaces.frameSurface, input.paintsMedia ?? false, {
			maskId: input.maskId ?? 'feature-match-overlay-frame-mask',
			glowFilterId: input.frameGlowFilterId ?? 'feature-match-overlay-frame-glow',
		}),
		rectStyle,
	};
}
