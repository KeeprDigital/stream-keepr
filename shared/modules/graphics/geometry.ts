import type { GeometryUnit, GraphicAnchorPoint, GraphicRect } from '../../types/graphics';
import type { NinePointDefinition } from '../../utils/ninePoints';
import { NINE_POINTS } from '../../utils/ninePoints';

/**
 * Canvas geometry for the shared compositor.
 *
 * A Graphic Anchor Point is an editing and geometry reference: it decides which
 * point of the item an author positions and which point stays fixed while the
 * item is resized. Stored geometry always remains a top-left rectangle in
 * canvas pixels, and a Geometry Unit only changes how that geometry is displayed
 * and entered.
 */

/** A Graphic Anchor Point's view of the shared nine-point table. */
export interface GraphicAnchorPointDefinition extends NinePointDefinition {
	value: GraphicAnchorPoint;
}

export const GRAPHIC_ANCHOR_POINTS: readonly GraphicAnchorPointDefinition[] = NINE_POINTS;

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

/**
 * Move a rectangle so its edge (or centre) on one axis meets the matching edge
 * (or centre) of its container. The result is a stored top-left coordinate, so
 * the Graphic Anchor Point plays no part.
 */
export function alignGraphicRect(
	rect: GraphicRect,
	axis: 'x' | 'y',
	edge: 'start' | 'center' | 'end',
	container: { width: number; height: number },
): Partial<GraphicRect> {
	const total = axis === 'x' ? container.width : container.height;
	const size = axis === 'x' ? rect.width : rect.height;
	const start = edge === 'start' ? 0 : edge === 'end' ? total - size : (total - size) / 2;
	return { [axis]: roundGeometry(start) };
}

/** Project canonical pixels into the Geometry Unit an author is working in. */
export function displayGeometryValue(
	pixels: number,
	total: number,
	unit: GeometryUnit,
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
export function parseGeometryValue(
	value: number,
	total: number,
	unit: GeometryUnit,
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
