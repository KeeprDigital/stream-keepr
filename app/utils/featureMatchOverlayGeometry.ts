import type { FeatureMatchOverlayRect, FeatureMatchSourceItemConfig, FeatureMatchSourceSurfaceStyle } from '~~/shared/types/screenConfig';

export type FeatureMatchOverlayGeometryUnit = 'px' | '%' | 'center';
export type { FeatureMatchOverlayAnchorValue } from '~~/shared/types/screenConfig';
type FeatureMatchOverlayAnchoredGeometryField = keyof FeatureMatchOverlayRect;

export const FEATURE_MATCH_OVERLAY_ANCHOR_POINTS = [
	{ label: 'Top left', value: 'top-left', x: 0, y: 0, icon: 'i-lucide-arrow-up-left' },
	{ label: 'Top', value: 'top', x: 0.5, y: 0, icon: 'i-lucide-arrow-up' },
	{ label: 'Top right', value: 'top-right', x: 1, y: 0, icon: 'i-lucide-arrow-up-right' },
	{ label: 'Left', value: 'left', x: 0, y: 0.5, icon: 'i-lucide-arrow-left' },
	{ label: 'Center', value: 'center', x: 0.5, y: 0.5, icon: 'i-lucide-crosshair' },
	{ label: 'Right', value: 'right', x: 1, y: 0.5, icon: 'i-lucide-arrow-right' },
	{ label: 'Bottom left', value: 'bottom-left', x: 0, y: 1, icon: 'i-lucide-arrow-down-left' },
	{ label: 'Bottom', value: 'bottom', x: 0.5, y: 1, icon: 'i-lucide-arrow-down' },
	{ label: 'Bottom right', value: 'bottom-right', x: 1, y: 1, icon: 'i-lucide-arrow-down-right' },
] as const;

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

export function pixelsToPercent(value: number, total: number): number {
	if (total <= 0)
		return 0;
	return Number(((value / total) * 100).toFixed(4));
}

export function percentToPixels(value: number, total: number): number {
	return Math.round((value / 100) * total);
}

export function pixelsToCenteredGrid(value: number, total: number, isPosition: boolean): number {
	if (total <= 0)
		return 0;
	const gridValue = (value / total) * 32;
	return Number((isPosition ? gridValue - 16 : gridValue).toFixed(2));
}

export function centeredGridToPixels(value: number, total: number, isPosition: boolean): number {
	const normalized = isPosition ? value + 16 : value;
	return Math.round((normalized / 32) * total);
}

export function displayGeometryValue(value: number, total: number, unit: FeatureMatchOverlayGeometryUnit, isPosition = false): string {
	if (unit === '%')
		return String(pixelsToPercent(value, total));
	if (unit === 'center')
		return String(pixelsToCenteredGrid(value, total, isPosition));
	return String(value);
}

export function parseGeometryInput(value: string | number, total: number, unit: FeatureMatchOverlayGeometryUnit, isPosition = false): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric))
		return 0;
	if (unit === '%')
		return percentToPixels(numeric, total);
	if (unit === 'center')
		return centeredGridToPixels(numeric, total, isPosition);
	return Math.round(numeric);
}

export function roundFeatureMatchOverlayGeometryValue(value: number): number {
	return Math.round(value * 100) / 100;
}

export type FeatureMatchOverlayAlignment = 'left' | 'center' | 'right' | 'top' | 'bottom';

/** The anchored coordinate for a hard-edge or center alignment along one axis. */
export function featureMatchOverlayAlignmentCoordinate(alignment: FeatureMatchOverlayAlignment, total: number): number {
	if (alignment === 'left' || alignment === 'top')
		return 0;
	if (alignment === 'right' || alignment === 'bottom')
		return roundFeatureMatchOverlayGeometryValue(total);
	return roundFeatureMatchOverlayGeometryValue(total / 2);
}

export function resolveFeatureMatchOverlayAnchor(value: string | undefined) {
	return FEATURE_MATCH_OVERLAY_ANCHOR_POINTS.find(point => point.value === value) ?? FEATURE_MATCH_OVERLAY_ANCHOR_POINTS[0];
}

export function anchorFeatureMatchOverlayRect<T extends FeatureMatchOverlayRect>(rect: T, anchorValue: string | undefined): T {
	const anchor = resolveFeatureMatchOverlayAnchor(anchorValue);
	return {
		...rect,
		x: roundFeatureMatchOverlayGeometryValue(rect.x + (rect.width * anchor.x)),
		y: roundFeatureMatchOverlayGeometryValue(rect.y + (rect.height * anchor.y)),
	};
}

export function updateFeatureMatchOverlayRectFromAnchor<T extends FeatureMatchOverlayRect>(
	rect: T,
	field: FeatureMatchOverlayAnchoredGeometryField,
	value: number,
	anchorValue: string | undefined,
): Partial<FeatureMatchOverlayRect> {
	const anchor = resolveFeatureMatchOverlayAnchor(anchorValue);

	if (field === 'x') {
		return { x: roundFeatureMatchOverlayGeometryValue(value - (rect.width * anchor.x)) };
	}

	if (field === 'y') {
		return { y: roundFeatureMatchOverlayGeometryValue(value - (rect.height * anchor.y)) };
	}

	const width = field === 'width' ? Math.round(value) : rect.width;
	const height = field === 'height' ? Math.round(value) : rect.height;

	return resizeFeatureMatchOverlayRectFromAnchor(rect, width, height, anchorValue);
}

export function resizeFeatureMatchOverlayRectFromAnchor<T extends FeatureMatchOverlayRect>(
	rect: T,
	width: number,
	height: number,
	anchorValue: string | undefined,
): FeatureMatchOverlayRect {
	const anchor = resolveFeatureMatchOverlayAnchor(anchorValue);
	const fixedAnchorX = rect.x + (rect.width * anchor.x);
	const fixedAnchorY = rect.y + (rect.height * anchor.y);
	const nextWidth = Math.round(width);
	const nextHeight = Math.round(height);

	return {
		x: roundFeatureMatchOverlayGeometryValue(fixedAnchorX - (nextWidth * anchor.x)),
		y: roundFeatureMatchOverlayGeometryValue(fixedAnchorY - (nextHeight * anchor.y)),
		width: nextWidth,
		height: nextHeight,
	};
}

function pixelValue(value: number | undefined, fallback = 0): number {
	const numeric = Number(value ?? fallback);
	return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, fallback);
}

function borderSideEnabled(style: FeatureMatchSourceSurfaceStyle, side: 'Top' | 'Right' | 'Bottom' | 'Left'): boolean {
	return style[`border${side}Visible` as keyof FeatureMatchSourceSurfaceStyle] !== false;
}

function borderSideInset(style: FeatureMatchSourceSurfaceStyle, side: 'Top' | 'Right' | 'Bottom' | 'Left', borderWidth: number): number {
	return style.borderVisible && borderSideEnabled(style, side) ? borderWidth : 0;
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

export function featureMatchOverlaySourceCutoutRect(region: FeatureMatchSourceItemConfig): FeatureMatchOverlayRoundedRect {
	const style: FeatureMatchSourceSurfaceStyle = region.surfaceStyle ?? {};
	const borderWidth = style.borderVisible ? pixelValue(style.borderWidth) : 0;
	const regionWidth = pixelValue(region.width);
	const regionHeight = pixelValue(region.height);
	const [leftInset, rightInset] = fitFeatureMatchOverlayInsets(
		borderSideInset(style, 'Left', borderWidth),
		borderSideInset(style, 'Right', borderWidth),
		regionWidth,
	);
	const [topInset, bottomInset] = fitFeatureMatchOverlayInsets(
		borderSideInset(style, 'Top', borderWidth),
		borderSideInset(style, 'Bottom', borderWidth),
		regionHeight,
	);
	const width = Math.max(0, regionWidth - leftInset - rightInset);
	const height = Math.max(0, regionHeight - topInset - bottomInset);
	const outerRadii = resolveFeatureMatchOverlayCornerRadii(style);

	return {
		x: region.x + leftInset,
		y: region.y + topInset,
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
