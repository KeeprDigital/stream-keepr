import type { GraphicAnchorPoint, GraphicRect } from '~~/shared/types/graphics';
import { resolveGraphicAnchorPoint } from '~~/shared/modules/graphics/geometry';

/**
 * Direct manipulation of one rectangle on an editor canvas: dragging it, resizing
 * it from one of eight handles, and nudging it from the keyboard.
 *
 * Pure, and in the pixels of the rectangle's container throughout: the canvas,
 * or a Graphic Group's padded box for its child. The overlay that turns pointer
 * movement into a delta owns the preview's scale; this owns what a delta does to
 * a stored top-left rectangle, and the snapping that makes the canvas's and other
 * layers' edges and centres easy to hit.
 */

export type ManipulationHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_HANDLES = [
	'nw',
	'n',
	'ne',
	'e',
	'se',
	's',
	'sw',
	'w',
] as const satisfies readonly ManipulationHandle[];

/** The smallest a rectangle is ever resized to, in canvas pixels. */
const MIN_SIZE = 1;

export interface SnapLines {
	/** x positions an edge or centre may snap to. */
	x: readonly number[];
	/** y positions an edge or centre may snap to. */
	y: readonly number[];
	/** The boxes of the layers beside the moving one, for measuring the gap to them. */
	neighbours?: readonly GraphicRect[];
}

/** The empty span between a rectangle and its nearest neighbour along one axis. */
export interface NeighbourGap {
	from: number;
	to: number;
	/** The middle of the span the two share across the gap, on the other axis. */
	at: number;
}

export interface ManipulationOptions {
	/** Keep the starting width-to-height ratio while resizing. */
	keepRatio?: boolean;
	/** Lines to snap to, and how close counts as on one. */
	snap?: { lines: SnapLines; threshold: number };
	/**
	 * The rectangle's Graphic Rotation about its Graphic Anchor Point. A rotated
	 * rectangle snaps the box it covers while moving. It resizes along its own axes,
	 * keeping the opposite handle where it is drawn, and does not snap while resizing.
	 */
	rotation?: number;
	anchor?: GraphicAnchorPoint;
}

export interface ManipulationResult {
	rect: GraphicRect;
	/** The snap lines the result landed on, for the overlay to draw. */
	snapped: { x?: number; y?: number };
}

/**
 * A layer as snapping sees it, in its container's pixels: a Source Item, a
 * Graphic Item, or a Graphic Group with the children it positions inside its
 * padded box.
 */
export interface SnapLayer extends GraphicRect {
	id: string;
	visible: boolean;
	/** Graphic Rotation in degrees about the Graphic Anchor Point. */
	rotation?: number;
	anchor?: GraphicAnchorPoint;
	/** A Graphic Group's arrangement; only a canvas-arranged group's children keep their stored rectangles. */
	arrangement?: string;
	padding?: number;
	children?: readonly SnapLayer[];
}

/**
 * The axis-aligned box a rectangle covers once rotated about its Graphic Anchor
 * Point, to two decimal places so a quarter turn lands on whole pixels.
 */
export function rotatedBounds(rect: GraphicRect, rotation = 0, anchor?: GraphicAnchorPoint): GraphicRect {
	if (rotation % 360 === 0) {
		return {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
		};
	}
	const point = resolveGraphicAnchorPoint(anchor);
	const pivotX = rect.x + rect.width * point.x;
	const pivotY = rect.y + rect.height * point.y;
	const radians = rotation * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const xs: number[] = [];
	const ys: number[] = [];
	for (const [cornerX, cornerY] of [
		[rect.x, rect.y],
		[rect.x + rect.width, rect.y],
		[rect.x, rect.y + rect.height],
		[rect.x + rect.width, rect.y + rect.height],
	] as const) {
		const dx = cornerX - pivotX;
		const dy = cornerY - pivotY;
		xs.push(pivotX + dx * cos - dy * sin);
		ys.push(pivotY + dx * sin + dy * cos);
	}
	const left = roundBound(Math.min(...xs));
	const top = roundBound(Math.min(...ys));
	return {
		x: left,
		y: top,
		width: roundBound(Math.max(...xs)) - left,
		height: roundBound(Math.max(...ys)) - top,
	};
}

function roundBound(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * The lines a layer may snap to, in its container's pixels: the edges and centre
 * of every other visible layer beside it, and the canvas's edges and centre
 * lines. A group child is beside its siblings and also snaps to its group's box,
 * outer and padded, with everything measured from the padded box's corner; a
 * hidden group hides them all. A layer on the canvas is also beside the children
 * of an unrotated canvas-arranged group. A rotated layer offers the axis-aligned
 * box it covers.
 */
export function canvasSnapLines(
	canvas: { width: number; height: number },
	layers: readonly SnapLayer[] = [],
	layerId?: string,
): SnapLines {
	const group = layers.find(layer => layer.children?.some(child => child.id === layerId));
	const padding = groupPadding(group);
	const origin = group
		? { x: group.x + padding, y: group.y + padding }
		: { x: 0, y: 0 };
	const siblings = group
		? group.visible
			? group.children ?? []
			: []
		: layers.flatMap(layer => [
				layer,
				...placedChildren(layer),
			]);

	const x = [0, canvas.width / 2, canvas.width].map(line => line - origin.x);
	const y = [0, canvas.height / 2, canvas.height].map(line => line - origin.y);
	const add = (rect: GraphicRect) => {
		x.push(rect.x, rect.x + rect.width / 2, rect.x + rect.width);
		y.push(rect.y, rect.y + rect.height / 2, rect.y + rect.height);
	};
	if (group?.visible) {
		add({
			x: -padding,
			y: -padding,
			width: group.width,
			height: group.height,
		});
		add({
			x: 0,
			y: 0,
			width: group.width - 2 * padding,
			height: group.height - 2 * padding,
		});
	}
	const neighbours = siblings
		.filter(layer => layer.id !== layerId && layer.visible)
		.map(layer => rotatedBounds(layer, layer.rotation, layer.anchor));
	neighbours.forEach(add);
	return {
		x: uniqueSorted(x),
		y: uniqueSorted(y),
		neighbours,
	};
}

function groupPadding(group: SnapLayer | undefined): number {
	return Math.max(0, group?.padding ?? 0);
}

/** A group's children where they sit on the canvas, when their stored rectangles say so. */
function placedChildren(group: SnapLayer): SnapLayer[] {
	if (!group.visible || group.arrangement !== 'canvas' || (group.rotation ?? 0) % 360 !== 0)
		return [];
	const padding = groupPadding(group);
	return (group.children ?? []).map(child => ({
		...child,
		x: child.x + group.x + padding,
		y: child.y + group.y + padding,
	}));
}

/**
 * The gap to the nearest neighbour on each axis: one level with it on the other
 * axis, and clear of it. Display only; nothing snaps to equal spacing.
 */
export function neighbourGaps(rect: GraphicRect, neighbours: readonly GraphicRect[]): { x?: NeighbourGap; y?: NeighbourGap } {
	const gaps: { x?: NeighbourGap; y?: NeighbourGap } = {};
	for (const axis of ['x', 'y'] as const) {
		const size = axis === 'x'
			? 'width'
			: 'height';
		const cross = axis === 'x'
			? 'y'
			: 'x';
		const crossSize = axis === 'x'
			? 'height'
			: 'width';
		for (const other of neighbours) {
			const sharedStart = Math.max(rect[cross], other[cross]);
			const sharedEnd = Math.min(rect[cross] + rect[crossSize], other[cross] + other[crossSize]);
			if (sharedEnd <= sharedStart)
				continue;
			const gap = other[axis] >= rect[axis] + rect[size]
				? { from: rect[axis] + rect[size], to: other[axis] }
				: { from: other[axis] + other[size], to: rect[axis] };
			const nearest = gaps[axis];
			if (gap.to > gap.from && (!nearest || gap.to - gap.from < nearest.to - nearest.from))
				gaps[axis] = { ...gap, at: (sharedStart + sharedEnd) / 2 };
		}
	}
	return gaps;
}

function uniqueSorted(values: readonly number[]): number[] {
	return [
		...new Set(values.map(roundBound)),
	].sort((a, b) => a - b);
}

function nearest(candidates: readonly number[], lines: readonly number[], threshold: number) {
	let best: { offset: number; line: number } | undefined;
	for (const candidate of candidates) {
		for (const line of lines) {
			const offset = line - candidate;
			if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset)))
				best = { offset, line };
		}
	}
	return best;
}

function round(rect: GraphicRect): GraphicRect {
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.max(MIN_SIZE, Math.round(rect.width)),
		height: Math.max(MIN_SIZE, Math.round(rect.height)),
	};
}

function moveRect(start: GraphicRect, delta: { x: number; y: number }, options: ManipulationOptions): ManipulationResult {
	let x = start.x + delta.x;
	let y = start.y + delta.y;
	const snapped: ManipulationResult['snapped'] = {};
	if (options.snap) {
		const { lines, threshold } = options.snap;
		const covered = rotatedBounds({ ...start, x, y }, options.rotation, options.anchor);
		const snapX = nearest([covered.x, covered.x + covered.width / 2, covered.x + covered.width], lines.x, threshold);
		const snapY = nearest([covered.y, covered.y + covered.height / 2, covered.y + covered.height], lines.y, threshold);
		if (snapX) {
			x += snapX.offset;
			snapped.x = snapX.line;
		}
		if (snapY) {
			y += snapY.offset;
			snapped.y = snapY.line;
		}
	}
	return {
		rect: round({ ...start, x, y }),
		snapped,
	};
}

type ResizeHandle = Exclude<ManipulationHandle, 'move'>;

/** Where a point of a rectangle, as fractions of its size, is drawn once rotated about its anchor. */
function drawnPoint(rect: GraphicRect, fraction: { x: number; y: number }, rotation: number, anchor: GraphicAnchorPoint | undefined) {
	const point = resolveGraphicAnchorPoint(anchor);
	const turned = rotate({
		x: (fraction.x - point.x) * rect.width,
		y: (fraction.y - point.y) * rect.height,
	}, rotation);
	return {
		x: rect.x + rect.width * point.x + turned.x,
		y: rect.y + rect.height * point.y + turned.y,
	};
}

function rotate(vector: { x: number; y: number }, degrees: number) {
	const radians = degrees * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: vector.x * cos - vector.y * sin,
		y: vector.x * sin + vector.y * cos,
	};
}

/** The handle opposite the dragged one, as fractions of the rectangle's size. */
function oppositeFraction(handle: ResizeHandle) {
	return {
		x: handle.includes('w')
			? 1
			: handle.includes('e')
				? 0
				: 0.5,
		y: handle.includes('n')
			? 1
			: handle.includes('s')
				? 0
				: 0.5,
	};
}

/**
 * Resize a rotated rectangle along its own axes: the drag is turned into them,
 * sizes the rectangle as if it were upright, and the result is placed so the
 * handle opposite the dragged one is drawn where it was (E33). Never snaps (E34).
 */
function resizeRotatedRect(
	start: GraphicRect,
	handle: ResizeHandle,
	delta: { x: number; y: number },
	options: ManipulationOptions & { rotation: number },
): ManipulationResult {
	const { rotation, anchor } = options;
	const upright = resizeRect(start, handle, rotate(delta, -rotation), { keepRatio: options.keepRatio });
	const fixed = oppositeFraction(handle);
	const target = drawnPoint(start, fixed, rotation, anchor);
	const sized = { ...upright.rect, x: 0, y: 0 };
	const drawn = drawnPoint(sized, fixed, rotation, anchor);
	return {
		rect: round({
			...sized,
			x: target.x - drawn.x,
			y: target.y - drawn.y,
		}),
		snapped: {},
	};
}

function resizeRect(
	start: GraphicRect,
	handle: ResizeHandle,
	delta: { x: number; y: number },
	options: ManipulationOptions,
): ManipulationResult {
	if ((options.rotation ?? 0) % 360 !== 0)
		return resizeRotatedRect(start, handle, delta, { ...options, rotation: options.rotation! });
	let left = start.x;
	let top = start.y;
	let right = start.x + start.width;
	let bottom = start.y + start.height;
	const snapped: ManipulationResult['snapped'] = {};
	const snap = options.snap;

	if (handle.includes('w'))
		left = Math.min(left + delta.x, right - MIN_SIZE);
	if (handle.includes('e'))
		right = Math.max(right + delta.x, left + MIN_SIZE);
	if (handle.includes('n'))
		top = Math.min(top + delta.y, bottom - MIN_SIZE);
	if (handle.includes('s'))
		bottom = Math.max(bottom + delta.y, top + MIN_SIZE);

	if (snap) {
		const horizontal = handle.includes('w')
			? 'left'
			: handle.includes('e')
				? 'right'
				: undefined;
		const vertical = handle.includes('n')
			? 'top'
			: handle.includes('s')
				? 'bottom'
				: undefined;
		if (horizontal) {
			const edge = nearest([
				horizontal === 'left'
					? left
					: right,
			], snap.lines.x, snap.threshold);
			if (edge) {
				if (horizontal === 'left')
					left = Math.min(left + edge.offset, right - MIN_SIZE);
				else
					right = Math.max(right + edge.offset, left + MIN_SIZE);
				snapped.x = edge.line;
			}
		}
		if (vertical) {
			const edge = nearest([
				vertical === 'top'
					? top
					: bottom,
			], snap.lines.y, snap.threshold);
			if (edge) {
				if (vertical === 'top')
					top = Math.min(top + edge.offset, bottom - MIN_SIZE);
				else
					bottom = Math.max(bottom + edge.offset, top + MIN_SIZE);
				snapped.y = edge.line;
			}
		}
	}

	let rect: GraphicRect = {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	};

	// A corner keeps the ratio by following whichever axis moved further; an edge
	// handle keeps it by growing the other axis about the rectangle's centre line.
	if (options.keepRatio && start.width > 0 && start.height > 0) {
		const ratio = start.width / start.height;
		const corner = handle.length === 2;
		const widthLeads = corner
			? Math.abs(rect.width - start.width) / start.width >= Math.abs(rect.height - start.height) / start.height
			: handle === 'e' || handle === 'w';
		const width = widthLeads
			? rect.width
			: rect.height * ratio;
		const height = widthLeads
			? rect.width / ratio
			: rect.height;
		const x = handle.includes('w')
			? right - width
			: corner || handle === 'e'
				? left
				: start.x + (start.width - width) / 2;
		const y = handle.includes('n')
			? bottom - height
			: corner || handle === 's'
				? top
				: start.y + (start.height - height) / 2;
		rect = { x, y, width, height };
		// A kept ratio decides the size, so a snap it overrode is not shown.
		delete snapped.x;
		delete snapped.y;
	}

	return {
		rect: round(rect),
		snapped,
	};
}

/** The rectangle a drag from `handle` by `delta` canvas pixels produces. */
export function manipulateRect(
	start: GraphicRect,
	handle: ManipulationHandle,
	delta: { x: number; y: number },
	options: ManipulationOptions = {},
): ManipulationResult {
	return handle === 'move'
		? moveRect(start, delta, options)
		: resizeRect(start, handle, delta, options);
}

/** A rotatable layer as a rotate drag sees it, in its container's pixels. */
export interface RotationFrame {
	rect: GraphicRect;
	/** Graphic Rotation in degrees about the Graphic Anchor Point. */
	rotation: number;
	anchor?: GraphicAnchorPoint;
}

/**
 * The Graphic Rotation a drag from `from` to `to` turns a layer to: its starting
 * rotation plus the angle the pointer swept about the Graphic Anchor Point, which
 * a rotation leaves in place. Whole degrees, or the nearest multiple of `step`,
 * within half a turn either way.
 */
export function dragRotation(
	frame: RotationFrame,
	from: { x: number; y: number },
	to: { x: number; y: number },
	options: { step?: number } = {},
): number {
	const point = resolveGraphicAnchorPoint(frame.anchor);
	const pivot = {
		x: frame.rect.x + frame.rect.width * point.x,
		y: frame.rect.y + frame.rect.height * point.y,
	};
	const angle = (point: { x: number; y: number }) => Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180 / Math.PI;
	const step = options.step && options.step > 0
		? options.step
		: 1;
	const turned = Math.round((frame.rotation + angle(to) - angle(from)) / step) * step;
	const wrapped = ((turned % 360) + 540) % 360 - 180;
	// Half a turn is drawn the same either way; keep the sign the drag arrived with.
	return wrapped === -180 && turned > 0
		? 180
		: wrapped + 0;
}

/** The rectangle an arrow-key nudge produces. */
export function nudgeRect(rect: GraphicRect, delta: { x: number; y: number }): GraphicRect {
	return {
		...rect,
		x: Math.round(rect.x + delta.x),
		y: Math.round(rect.y + delta.y),
	};
}
