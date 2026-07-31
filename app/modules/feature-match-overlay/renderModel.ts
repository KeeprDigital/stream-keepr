import type { CSSProperties } from 'vue';
import type {
	FeatureMatchOverlayBorderSides,
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayOutput,
	FeatureMatchOverlayRect,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayBorderSide } from '~/utils/featureMatchOverlayGeometry';
import {
	FEATURE_MATCH_OVERLAY_BORDER_SIDES,
	featureMatchOverlayBorderRadiusCss,
	featureMatchOverlayBorderSideEnabled,
	featureMatchOverlaySourceCutoutRect,
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
	borderSideEnabled: (style: FeatureMatchOverlayBorderSides, side: FeatureMatchOverlayBorderSide) => boolean;
}

function rectStyle(rect: FeatureMatchOverlayRect): CSSProperties {
	return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` };
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

function cssBackgroundStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceFramingStyle | undefined) {
	const opacity = style?.backgroundOpacity ?? 0;
	const color = style?.backgroundColor?.trim();
	const hasBaseColor = Boolean(color && !/^transparent$/i.test(color));

	if (output === 'key')
		return opacity > 0 && hasBaseColor ? colorWithOpacity(output, '#ffffff', opacity) : 'transparent';
	if (opacity <= 0 || !hasBaseColor)
		return 'transparent';

	return colorWithOpacity(output, color, opacity);
}

function cssGlowShadow(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceFramingStyle | undefined) {
	const size = Math.max(0, style?.glowSize ?? 0);
	if (output === 'key' || size <= 0 || !style?.borderVisible)
		return undefined;

	const visibleSides = FEATURE_MATCH_OVERLAY_BORDER_SIDES.filter(side => featureMatchOverlayBorderSideEnabled(style, side));
	if (visibleSides.length === 0)
		return undefined;

	const color = colorWithOpacity(output, style.glowColor ?? style.borderColor ?? '#ffffff', style.glowOpacity ?? 0.75);
	const insetSize = Math.max(1, Math.round(size / 2));
	if (visibleSides.length === FEATURE_MATCH_OVERLAY_BORDER_SIDES.length)
		return `0 0 ${size}px ${color}, inset 0 0 ${insetSize}px ${color}`;

	const sideShadows: Record<FeatureMatchOverlayBorderSide, string> = {
		Top: `0 -${size}px ${size}px -${size}px ${color}`,
		Right: `${size}px 0 ${size}px -${size}px ${color}`,
		Bottom: `0 ${size}px ${size}px -${size}px ${color}`,
		Left: `-${size}px 0 ${size}px -${size}px ${color}`,
	};

	return visibleSides.map(side => sideShadows[side]).join(', ');
}

function cssBorderStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchSourceFramingStyle | undefined) {
	if (!style) {
		return { border: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' };
	}

	const border = style.borderVisible ? `${style.borderWidth ?? 1}px solid ${output === 'key' ? '#fff' : (style.borderColor ?? '#fff')}` : 'none';
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

function sourceItemStyle(output: FeatureMatchOverlayOutput, item: FeatureMatchSourceItemConfig): CSSProperties {
	return {
		...rectStyle(item),
		position: 'absolute',
		boxSizing: 'border-box',
		background: cssBackgroundStyle(output, item.framingStyle),
		...cssBorderStyle(output, item.framingStyle),
		borderRadius: featureMatchOverlayBorderRadiusCss(item.framingStyle ?? {}),
		boxShadow: cssGlowShadow(output, item.framingStyle),
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
		borderSideEnabled: featureMatchOverlayBorderSideEnabled,
	};
}
