import type { GraphicAnchorPoint, GraphicGeometryUnit, GraphicRect } from '../../types/graphics';

/**
 * Canvas geometry for the shared compositor.
 *
 * A Graphic Anchor Point is an editing and geometry reference: it decides which
 * point of the item an author positions and which point stays fixed while the
 * item is resized. Stored geometry always remains a top-left rectangle in
 * canvas pixels, and a Graphic Geometry Unit only changes how that geometry is
 * displayed and entered.
 */

export interface GraphicAnchorPointDefinition {
	value: GraphicAnchorPoint;
	label: string;
	icon: string;
	/** Fraction of the item's width the anchor sits at. */
	x: number;
	/** Fraction of the item's height the anchor sits at. */
	y: number;
}

export const GRAPHIC_ANCHOR_POINTS: readonly GraphicAnchorPointDefinition[] = [
	{ value: 'top-left', label: 'Top left', icon: 'i-lucide-arrow-up-left', x: 0, y: 0 },
	{ value: 'top', label: 'Top', icon: 'i-lucide-arrow-up', x: 0.5, y: 0 },
	{ value: 'top-right', label: 'Top right', icon: 'i-lucide-arrow-up-right', x: 1, y: 0 },
	{ value: 'left', label: 'Left', icon: 'i-lucide-arrow-left', x: 0, y: 0.5 },
	{ value: 'center', label: 'Centre', icon: 'i-lucide-crosshair', x: 0.5, y: 0.5 },
	{ value: 'right', label: 'Right', icon: 'i-lucide-arrow-right', x: 1, y: 0.5 },
	{ value: 'bottom-left', label: 'Bottom left', icon: 'i-lucide-arrow-down-left', x: 0, y: 1 },
	{ value: 'bottom', label: 'Bottom', icon: 'i-lucide-arrow-down', x: 0.5, y: 1 },
	{ value: 'bottom-right', label: 'Bottom right', icon: 'i-lucide-arrow-down-right', x: 1, y: 1 },
];

export function resolveGraphicAnchorPoint(value: GraphicAnchorPoint | undefined): GraphicAnchorPointDefinition {
	return GRAPHIC_ANCHOR_POINTS.find(point => point.value === value) ?? GRAPHIC_ANCHOR_POINTS[0]!;
}

function roundGeometry(value: number): number {
	return Math.round(value * 100) / 100;
}

/** The coordinate an author sees and edits for a rectangle at one anchor. */
export function anchoredGraphicPosition(rect: GraphicRect, anchor: GraphicAnchorPoint | undefined) {
	const point = resolveGraphicAnchorPoint(anchor);
	return {
		x: roundGeometry(rect.x + (rect.width * point.x)),
		y: roundGeometry(rect.y + (rect.height * point.y)),
	};
}

/** Move a rectangle so its anchored coordinate becomes `value`. */
export function moveGraphicRectToAnchoredPosition(
	rect: GraphicRect,
	axis: 'x' | 'y',
	value: number,
	anchor: GraphicAnchorPoint | undefined,
): Partial<GraphicRect> {
	const point = resolveGraphicAnchorPoint(anchor);
	if (axis === 'x')
		return { x: roundGeometry(value - (rect.width * point.x)) };
	return { y: roundGeometry(value - (rect.height * point.y)) };
}

/** Resize a rectangle while its Graphic Anchor Point stays fixed. */
export function resizeGraphicRectFromAnchor(
	rect: GraphicRect,
	size: { width?: number; height?: number },
	anchor: GraphicAnchorPoint | undefined,
): GraphicRect {
	const point = resolveGraphicAnchorPoint(anchor);
	const fixedX = rect.x + (rect.width * point.x);
	const fixedY = rect.y + (rect.height * point.y);
	const width = Math.max(0, Math.round(size.width ?? rect.width));
	const height = Math.max(0, Math.round(size.height ?? rect.height));

	return {
		x: roundGeometry(fixedX - (width * point.x)),
		y: roundGeometry(fixedY - (height * point.y)),
		width,
		height,
	};
}

/** Project canonical pixels into the unit an author is working in. */
export function displayGraphicGeometryValue(
	pixels: number,
	total: number,
	unit: GraphicGeometryUnit,
	isPosition = false,
): number {
	if (unit === 'percent')
		return total > 0 ? roundGeometry((pixels / total) * 100) : 0;
	if (unit === 'grid') {
		if (total <= 0)
			return 0;
		const grid = (pixels / total) * 32;
		return roundGeometry(isPosition ? grid - 16 : grid);
	}
	return roundGeometry(pixels);
}

/** Read an authored value in any unit back into canonical pixels. */
export function parseGraphicGeometryValue(
	value: number,
	total: number,
	unit: GraphicGeometryUnit,
	isPosition = false,
): number {
	if (!Number.isFinite(value))
		return 0;
	if (unit === 'percent')
		return Math.round((value / 100) * total);
	if (unit === 'grid')
		return Math.round(((isPosition ? value + 16 : value) / 32) * total);
	return Math.round(value);
}
