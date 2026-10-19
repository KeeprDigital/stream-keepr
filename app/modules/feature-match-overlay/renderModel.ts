import type { CSSProperties } from 'vue';
import type {
	FeatureMatchOverlayFrameConfig,
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayOutput,
	FeatureMatchOverlayRect,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayBorderSide } from '~/utils/featureMatchOverlayGeometry';
import { screenOutputCanvasBackground } from '~~/shared/utils/screenOutput';
import { borderGlow, colourAtOpacity, glowDropShadow, glowFlood, paintColour } from '~/modules/screen/outputPaint';
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

export interface FeatureMatchOverlayRenderModelInput {
	config: FeatureMatchOverlayModeConfig;
	output: FeatureMatchOverlayOutput;
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
	/** The deliberate host-owned raw CSS gradient, painted in colour only. */
	gradientStyle: CSSProperties | undefined;
	fill: string;
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

/** A Source Item paints a border with no colour of its own white. */
const SOURCE_ITEM_UNSET_BORDER_COLOUR = '#ffffff';

function rectStyle(rect: FeatureMatchOverlayRect): CSSProperties {
	return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

function cssBackgroundStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceFramingStyle | undefined) {
	const gradient = style?.backgroundGradient?.trim();
	const opacity = style?.backgroundOpacity ?? (gradient ? 1 : 0);
	const color = style?.backgroundColor?.trim();
	const hasBaseColor = Boolean(color && !/^transparent$/i.test(color));

	if (opacity <= 0 || !(gradient || hasBaseColor))
		return 'transparent';
	// A Key Output is a matte: the raw CSS gradient becomes coverage, not colour.
	if (output === 'key')
		return colourAtOpacity(output, '#ffffff', opacity);
	if (gradient)
		return hasBaseColor ? `${gradient}, ${colourAtOpacity(output, color!, opacity)}` : gradient;

	return colourAtOpacity(output, color!, opacity);
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
): Pick<FeatureMatchOverlaySourceItemRenderModel, 'glowContainerStyle' | 'glowStyle'> | undefined {
	const style = item.framingStyle;
	if (!style?.borderVisible)
		return undefined;
	const glow = borderGlow(style);
	const filter = glowDropShadow(output, glow);
	if (!glow || !filter)
		return undefined;

	const visibleSides = FEATURE_MATCH_OVERLAY_BORDER_SIDES.filter(side => featureMatchOverlayBorderSideEnabled(style, side));
	if (visibleSides.length === 0)
		return undefined;

	const size = glow.size;
	const glowBorder = {
		...style,
		// CSS drop-shadow includes its source in the filtered result. The real
		// Source Item covers this duplicate border, but rounded-edge antialiasing
		// can leave subpixels visible. Matching the authored border colour keeps
		// those edge pixels identical while the filter still paints the glow colour.
		borderColor: style.borderColor ?? SOURCE_ITEM_UNSET_BORDER_COLOUR,
	};
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
			...(position === 'both' ? {} : sourceGlowMaskStyle(item, extent, position)),
		},
		glowStyle: {
			position: 'absolute',
			left: `${extent}px`,
			top: `${extent}px`,
			width: `${Math.max(0, item.width)}px`,
			height: `${Math.max(0, item.height)}px`,
			boxSizing: 'border-box',
			background: 'transparent',
			...cssBorderStyle(output, glowBorder),
			borderRadius: featureMatchOverlayBorderRadiusCss(style),
			filter,
			pointerEvents: 'none',
		},
	};
}

function cssBorderStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceFramingStyle | undefined) {
	if (!style) {
		return { border: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' };
	}

	const border = style.borderVisible
		? `${style.borderWidth ?? 1}px solid ${paintColour(output, style.borderColor ?? SOURCE_ITEM_UNSET_BORDER_COLOUR)}`
		: 'none';
	return {
		border: 'none',
		borderTop: featureMatchOverlayBorderSideEnabled(style, 'Top') ? border : 'none',
		borderRight: featureMatchOverlayBorderSideEnabled(style, 'Right') ? border : 'none',
		borderBottom: featureMatchOverlayBorderSideEnabled(style, 'Bottom') ? border : 'none',
		borderLeft: featureMatchOverlayBorderSideEnabled(style, 'Left') ? border : 'none',
	};
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

function svgFillColor(color: string | undefined) {
	return color?.trim() || 'transparent';
}

/**
 * The Frame's border, or none. A Frame border without a colour paints nothing in
 * the Fill Output, so the Key Output keys nothing for it either; its glow is a
 * shadow of that stroke, so it has no glow without one.
 */
function frameBorder(
	output: FeatureMatchOverlayOutput,
	frame: FeatureMatchOverlayFrameConfig,
	glowFilterId: string,
): FeatureMatchOverlayFrameBorderRenderModel | undefined {
	const color = frame.borderColor?.trim();
	if (!frame.borderVisible || !color)
		return undefined;

	const flood = glowFlood(output, borderGlow(frame));
	return {
		stroke: paintColour(output, color),
		strokeWidth: frame.borderWidth ?? 1,
		sides: FEATURE_MATCH_OVERLAY_BORDER_SIDES.filter(side => featureMatchOverlayBorderSideEnabled(frame, side)),
		glow: flood && {
			filterId: glowFilterId,
			stdDeviation: flood.stdDeviation,
			floodColor: flood.color,
			floodOpacity: flood.opacity,
		},
	};
}

function frameRenderModel(
	output: FeatureMatchOverlayOutput,
	frame: FeatureMatchOverlayFrameConfig,
	ids: { maskId: string; glowFilterId: string },
): FeatureMatchOverlayFrameRenderModel {
	const gradient = frame.gradient?.trim();
	return {
		maskId: ids.maskId,
		paintsImage: output !== 'key',
		imageStyle: { opacity: frame.opacity },
		imagePreserveAspectRatio: frameImagePreserveAspectRatio(frame.backgroundImageFit),
		gradientStyle: output !== 'key' && gradient
			? { background: frame.gradient, opacity: frame.opacity }
			: undefined,
		fill: output === 'key' ? paintColour(output, '#ffffff') : svgFillColor(frame.backgroundColor),
		opacity: frame.opacity,
		border: frameBorder(output, frame, ids.glowFilterId),
	};
}

function sourceItemStyle(output: FeatureMatchOverlayOutput, item: FeatureMatchSourceItemConfig): CSSProperties {
	return {
		...rectStyle(item),
		position: 'absolute',
		boxSizing: 'border-box',
		background: cssBackgroundStyle(output, item.framingStyle),
		...cssBorderStyle(output, item.framingStyle),
		borderRadius: featureMatchOverlayBorderRadiusCss(item.framingStyle ?? {}),
		overflow: 'hidden',
		pointerEvents: 'none',
	};
}

export function resolveFeatureMatchOverlayRenderModel(
	input: FeatureMatchOverlayRenderModelInput,
): FeatureMatchOverlayRenderModel {
	const { output, config } = input;
	const sourceItems = config.layout.sources
		.filter(item => item.visible)
		.map((item) => {
			const glow = sourceGlowStyles(output, item);
			return {
				item,
				style: sourceItemStyle(output, item),
				...glow,
				cutoutPath: item.frameCutout
					? roundedRectPath(featureMatchOverlaySourceCutoutRect(item)) || null
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
		frame: frameRenderModel(output, config.layout.frame, {
			maskId: input.maskId ?? 'feature-match-overlay-frame-mask',
			glowFilterId: input.frameGlowFilterId ?? 'feature-match-overlay-frame-glow',
		}),
		rectStyle,
	};
}
