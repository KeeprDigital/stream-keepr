import type { CSSProperties } from 'vue';
import type {
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayOutput,
	FeatureMatchOverlayRect,
	FeatureMatchSourceItemConfig,
	FeatureMatchSourceSurfaceStyle,
} from '~~/shared/types/screenConfig';
import { featureMatchOverlayBorderRadiusCss, featureMatchOverlaySourceCutoutRect, roundedRectPath } from '~/utils/featureMatchOverlayGeometry';

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

export type FeatureMatchOverlayBorderSide = 'Top' | 'Right' | 'Bottom' | 'Left';

export interface FeatureMatchOverlayRenderModelInput {
	config: FeatureMatchOverlayModeConfig;
	output: FeatureMatchOverlayOutput;
	maskId?: string;
}

export interface FeatureMatchOverlayFrameRenderModel {
	maskId: string;
	imageStyle: CSSProperties;
	imagePreserveAspectRatio: string;
	fill: string;
	opacity: number;
}

export interface FeatureMatchOverlaySourceItemRenderModel {
	item: FeatureMatchSourceItemConfig;
	style: CSSProperties;
	cutoutPath: string | null;
}

export interface FeatureMatchOverlayRenderModel {
	output: FeatureMatchOverlayOutput;
	canvasStyle: CSSProperties;
	sourceItems: FeatureMatchOverlaySourceItemRenderModel[];
	sourceCutouts: Array<{ id: string; path: string }>;
	frame: FeatureMatchOverlayFrameRenderModel;
	rectStyle: (rect: FeatureMatchOverlayRect) => CSSProperties;
	borderSideEnabled: (
		style: { borderTopVisible?: boolean; borderRightVisible?: boolean; borderBottomVisible?: boolean; borderLeftVisible?: boolean },
		side: FeatureMatchOverlayBorderSide,
	) => boolean;
}

function rectStyle(rect: FeatureMatchOverlayRect): CSSProperties {
	return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

/**
 * Per-side border visibility, which the Frame and Source Items keep.
 *
 * The shared Graphic Surface Style dropped per-side borders in favour of composed
 * rule-preset Shape Graphic Items. This is the host layer, whose Frame draws four
 * independent edges around the whole canvas and whose Source Items are framed
 * against them, and the Host Contract leaves host capability with the host.
 */
function borderSideEnabled(
	style: { borderTopVisible?: boolean; borderRightVisible?: boolean; borderBottomVisible?: boolean; borderLeftVisible?: boolean },
	side: FeatureMatchOverlayBorderSide,
) {
	return style[`border${side}Visible` as keyof typeof style] ?? true;
}

function colorWithOpacity(output: FeatureMatchOverlayOutput, color: string | undefined, opacity: number | undefined) {
	const fallback = color || '#000000';
	const alpha = Math.max(0, Math.min(1, opacity ?? 1));
	if (output === 'key') {
		const value = Math.round(alpha * 255).toString(16).padStart(2, '0');
		return `#ffffff${value}`;
	}
	if (alpha <= 0)
		return 'transparent';
	if (alpha >= 1)
		return fallback;

	const hex = fallback.trim();
	const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
	if (!match)
		return fallback;

	const [, r, g, b] = match;
	return `rgba(${Number.parseInt(r!, 16)}, ${Number.parseInt(g!, 16)}, ${Number.parseInt(b!, 16)}, ${alpha})`;
}

function cssBackgroundStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceSurfaceStyle | undefined) {
	const opacity = style?.backgroundOpacity ?? 0;
	const color = style?.backgroundColor?.trim();
	const hasBaseColor = Boolean(color && !/^transparent$/i.test(color));

	if (output === 'key')
		return opacity > 0 && hasBaseColor ? colorWithOpacity(output, '#ffffff', opacity) : 'transparent';
	if (opacity <= 0 || !hasBaseColor)
		return 'transparent';

	return colorWithOpacity(output, color, opacity);
}

const BORDER_SIDES: FeatureMatchOverlayBorderSide[] = ['Top', 'Right', 'Bottom', 'Left'];

function cssGlowShadow(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceSurfaceStyle | undefined) {
	const size = Math.max(0, style?.glowSize ?? 0);
	if (output === 'key' || size <= 0 || !style?.borderVisible)
		return undefined;

	const visibleSides = BORDER_SIDES.filter(side => borderSideEnabled(style, side));
	if (visibleSides.length === 0)
		return undefined;

	const color = colorWithOpacity(output, style.glowColor ?? style.borderColor ?? '#ffffff', style.glowOpacity ?? 0.75);
	const insetSize = Math.max(1, Math.round(size / 2));
	if (visibleSides.length === BORDER_SIDES.length)
		return `0 0 ${size}px ${color}, inset 0 0 ${insetSize}px ${color}`;

	const sideShadows: Record<FeatureMatchOverlayBorderSide, string> = {
		Top: `0 -${size}px ${size}px -${size}px ${color}`,
		Right: `${size}px 0 ${size}px -${size}px ${color}`,
		Bottom: `0 ${size}px ${size}px -${size}px ${color}`,
		Left: `-${size}px 0 ${size}px -${size}px ${color}`,
	};

	return visibleSides.map(side => sideShadows[side]).join(', ');
}

function cssBorderStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceSurfaceStyle | undefined) {
	if (!style) {
		return { border: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' };
	}

	const border = style.borderVisible ? `${style.borderWidth ?? 1}px solid ${output === 'key' ? '#fff' : (style.borderColor ?? '#fff')}` : 'none';
	return {
		border: 'none',
		borderTop: borderSideEnabled(style, 'Top') ? border : 'none',
		borderRight: borderSideEnabled(style, 'Right') ? border : 'none',
		borderBottom: borderSideEnabled(style, 'Bottom') ? border : 'none',
		borderLeft: borderSideEnabled(style, 'Left') ? border : 'none',
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

function sourceItemStyle(output: FeatureMatchOverlayOutput, item: FeatureMatchSourceItemConfig): CSSProperties {
	return {
		...rectStyle(item),
		position: 'absolute',
		boxSizing: 'border-box',
		background: cssBackgroundStyle(output, item.surfaceStyle),
		...cssBorderStyle(output, item.surfaceStyle),
		borderRadius: featureMatchOverlayBorderRadiusCss(item.surfaceStyle ?? {}),
		boxShadow: cssGlowShadow(output, item.surfaceStyle),
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
		.map(item => ({
			item,
			style: sourceItemStyle(output, item),
			cutoutPath: item.frameCutout
				? roundedRectPath(featureMatchOverlaySourceCutoutRect(item)) || null
				: null,
		}));

	return {
		output,
		canvasStyle: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			background: output === 'overlay' ? 'transparent' : '#000',
		},
		sourceItems,
		sourceCutouts: sourceItems
			.filter(source => source.cutoutPath)
			.map(source => ({ id: source.item.id, path: source.cutoutPath! })),
		frame: {
			maskId: input.maskId ?? 'feature-match-overlay-frame-mask',
			imageStyle: { opacity: config.layout.frame.opacity },
			imagePreserveAspectRatio: frameImagePreserveAspectRatio(config.layout.frame.backgroundImageFit),
			fill: output === 'key' ? '#fff' : svgFillColor(config.layout.frame.backgroundColor),
			opacity: config.layout.frame.opacity,
		},
		rectStyle,
		borderSideEnabled,
	};
}
