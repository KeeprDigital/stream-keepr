import type { MediaClipShapeGeometry, MediaClipShapeGeometryCorner } from '~~/shared/types/graphicItem';

function cornerSize(corner: MediaClipShapeGeometryCorner, kind: 'rounded' | 'cut'): number {
	return corner.kind === kind ? Math.max(0, corner.size) : 0;
}

function bounded(value: number | undefined, maximum: number): number {
	return Math.min(maximum, Math.max(0, value ?? 0));
}

export function shapeGeometryBorderRadius(geometry: MediaClipShapeGeometry | undefined): string | undefined {
	if (!geometry)
		return;
	return [
		cornerSize(geometry.topLeft, 'rounded'),
		cornerSize(geometry.topRight, 'rounded'),
		cornerSize(geometry.bottomRight, 'rounded'),
		cornerSize(geometry.bottomLeft, 'rounded'),
	].map(value => `${value}px`).join(' ');
}

export function shapeGeometryClipPath(
	geometry: MediaClipShapeGeometry | undefined,
	width: number,
	height: number,
): string | undefined {
	if (!geometry)
		return;
	const maximumInset = Math.max(0, Math.min(width / 2, height / 2));
	const topLeft = bounded(cornerSize(geometry.topLeft, 'cut'), maximumInset);
	const topRight = bounded(cornerSize(geometry.topRight, 'cut'), maximumInset);
	const bottomRight = bounded(cornerSize(geometry.bottomRight, 'cut'), maximumInset);
	const bottomLeft = bounded(cornerSize(geometry.bottomLeft, 'cut'), maximumInset);
	const leftSlant = bounded(geometry.leftEdgeSlant, maximumInset);
	const rightSlant = bounded(geometry.rightEdgeSlant, maximumInset);
	if (
		topLeft === 0
		&& topRight === 0
		&& bottomRight === 0
		&& bottomLeft === 0
		&& leftSlant === 0
		&& rightSlant === 0
	) {
		return;
	}
	const points = [
		[Math.max(topLeft, leftSlant), 0],
		[width - Math.max(topRight, rightSlant), 0],
		[width, Math.max(topRight, rightSlant)],
		[width, height - bottomRight],
		[width - bottomRight, height],
		[bottomLeft, height],
		[0, height - bottomLeft],
		[0, Math.max(topLeft, leftSlant)],
	];
	return `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(', ')})`;
}
