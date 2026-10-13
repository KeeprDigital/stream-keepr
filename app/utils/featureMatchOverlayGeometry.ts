import type { FeatureMatchOverlayBorderSides, FeatureMatchSourceFramingStyle, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';

export interface FeatureMatchOverlayCornerRadii {
	topLeft: number;
	topRight: number;
	bottomRight: number;
	bottomLeft: number;
}

export interface FeatureMatchOverlayRadiusConfig {
	borderRadius?: number;
	borderRadiusTopLeft?: number;
	borderRadiusTopRight?: number;
	borderRadiusBottomRight?: number;
	borderRadiusBottomLeft?: number;
}

export interface FeatureMatchOverlayRoundedRect {
	x: number;
	y: number;
	width: number;
	height: number;
	radii: FeatureMatchOverlayCornerRadii;
}

function pixelValue(value: number | undefined, fallback = 0): number {
	const numeric = Number(value ?? fallback);
	return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, fallback);
}

export type FeatureMatchOverlayBorderSide = 'Top' | 'Right' | 'Bottom' | 'Left';

export const FEATURE_MATCH_OVERLAY_BORDER_SIDES: readonly FeatureMatchOverlayBorderSide[] = ['Top', 'Right', 'Bottom', 'Left'];

/**
 * Per-side border visibility, which the Frame and its Source Items keep.
 *
 * The shared Graphic Surface Style dropped per-side borders in favour of composed
 * rule-preset Shape Graphic Items. This is the host layer, whose Frame draws four
 * independent edges around the whole canvas and whose Source Items are framed
 * against them, and the Host Contract leaves host capability with the host.
 */
export function featureMatchOverlayBorderSideEnabled(
	style: FeatureMatchOverlayBorderSides,
	side: FeatureMatchOverlayBorderSide,
): boolean {
	return style[`border${side}Visible` as keyof FeatureMatchOverlayBorderSides] ?? true;
}

function borderSideInset(style: FeatureMatchSourceFramingStyle, side: FeatureMatchOverlayBorderSide, borderWidth: number): number {
	return style.borderVisible && featureMatchOverlayBorderSideEnabled(style, side) ? borderWidth : 0;
}

function fitFeatureMatchOverlayInsets(startInset: number, endInset: number, total: number): [number, number] {
	const safeTotal = pixelValue(total);
	const start = Math.min(pixelValue(startInset), safeTotal);
	const end = Math.min(pixelValue(endInset), safeTotal);
	const combined = start + end;

	if (combined <= safeTotal)
		return [start, end];
	if (combined <= 0)
		return [0, 0];

	const scale = safeTotal / combined;
	return [start * scale, end * scale];
}

function mapRadii(radii: FeatureMatchOverlayCornerRadii, mapper: (value: number) => number): FeatureMatchOverlayCornerRadii {
	return {
		topLeft: mapper(radii.topLeft),
		topRight: mapper(radii.topRight),
		bottomRight: mapper(radii.bottomRight),
		bottomLeft: mapper(radii.bottomLeft),
	};
}

export function resolveFeatureMatchOverlayCornerRadii(config: FeatureMatchOverlayRadiusConfig): FeatureMatchOverlayCornerRadii {
	const radius = pixelValue(config.borderRadius);
	return {
		topLeft: pixelValue(config.borderRadiusTopLeft, radius),
		topRight: pixelValue(config.borderRadiusTopRight, radius),
		bottomRight: pixelValue(config.borderRadiusBottomRight, radius),
		bottomLeft: pixelValue(config.borderRadiusBottomLeft, radius),
	};
}

export function featureMatchOverlayBorderRadiusCss(config: FeatureMatchOverlayRadiusConfig): string {
	const radii = resolveFeatureMatchOverlayCornerRadii(config);
	return `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
}

export function insetFeatureMatchOverlayRadii(radii: FeatureMatchOverlayCornerRadii, inset: number): FeatureMatchOverlayCornerRadii {
	const safeInset = pixelValue(inset);
	return mapRadii(radii, value => Math.max(0, value - safeInset));
}

export function normalizeFeatureMatchOverlayRadiiForRect(radii: FeatureMatchOverlayCornerRadii, width: number, height: number): FeatureMatchOverlayCornerRadii {
	const safeWidth = pixelValue(width);
	const safeHeight = pixelValue(height);
	const safeRadii = mapRadii(radii, value => pixelValue(value));
	const scale = Math.min(
		1,
		safeRadii.topLeft + safeRadii.topRight > 0 ? safeWidth / (safeRadii.topLeft + safeRadii.topRight) : 1,
		safeRadii.bottomLeft + safeRadii.bottomRight > 0 ? safeWidth / (safeRadii.bottomLeft + safeRadii.bottomRight) : 1,
		safeRadii.topLeft + safeRadii.bottomLeft > 0 ? safeHeight / (safeRadii.topLeft + safeRadii.bottomLeft) : 1,
		safeRadii.topRight + safeRadii.bottomRight > 0 ? safeHeight / (safeRadii.topRight + safeRadii.bottomRight) : 1,
	);

	return mapRadii(safeRadii, value => value * scale);
}

export function featureMatchOverlaySourceCutoutRect(item: FeatureMatchSourceItemConfig): FeatureMatchOverlayRoundedRect {
	const style: FeatureMatchSourceFramingStyle = item.framingStyle ?? {};
	const borderWidth = style.borderVisible ? pixelValue(style.borderWidth) : 0;
	const itemWidth = pixelValue(item.width);
	const itemHeight = pixelValue(item.height);
	const [leftInset, rightInset] = fitFeatureMatchOverlayInsets(
		borderSideInset(style, 'Left', borderWidth),
		borderSideInset(style, 'Right', borderWidth),
		itemWidth,
	);
	const [topInset, bottomInset] = fitFeatureMatchOverlayInsets(
		borderSideInset(style, 'Top', borderWidth),
		borderSideInset(style, 'Bottom', borderWidth),
		itemHeight,
	);
	const width = Math.max(0, itemWidth - leftInset - rightInset);
	const height = Math.max(0, itemHeight - topInset - bottomInset);
	const outerRadii = resolveFeatureMatchOverlayCornerRadii(style);

	return {
		x: item.x + leftInset,
		y: item.y + topInset,
		width,
		height,
		radii: normalizeFeatureMatchOverlayRadiiForRect(
			{
				topLeft: Math.max(0, outerRadii.topLeft - Math.max(topInset, leftInset)),
				topRight: Math.max(0, outerRadii.topRight - Math.max(topInset, rightInset)),
				bottomRight: Math.max(0, outerRadii.bottomRight - Math.max(bottomInset, rightInset)),
				bottomLeft: Math.max(0, outerRadii.bottomLeft - Math.max(bottomInset, leftInset)),
			},
			width,
			height,
		),
	};
}

function arcTo(radius: number, x: number, y: number): string {
	return radius > 0 ? `A ${radius} ${radius} 0 0 1 ${x} ${y}` : `L ${x} ${y}`;
}

export function roundedRectPath(rect: FeatureMatchOverlayRoundedRect): string {
	if (rect.width <= 0 || rect.height <= 0)
		return '';

	const radii = normalizeFeatureMatchOverlayRadiiForRect(rect.radii, rect.width, rect.height);
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;

	return [
		`M ${rect.x + radii.topLeft} ${rect.y}`,
		`H ${right - radii.topRight}`,
		arcTo(radii.topRight, right, rect.y + radii.topRight),
		`V ${bottom - radii.bottomRight}`,
		arcTo(radii.bottomRight, right - radii.bottomRight, bottom),
		`H ${rect.x + radii.bottomLeft}`,
		arcTo(radii.bottomLeft, rect.x, bottom - radii.bottomLeft),
		`V ${rect.y + radii.topLeft}`,
		arcTo(radii.topLeft, rect.x + radii.topLeft, rect.y),
		'Z',
	].join(' ');
}
