import type { GraphicRect } from '~~/shared/types/graphics';

/**
 * Direct manipulation of one rectangle on an editor canvas: dragging it, resizing
 * it from one of eight handles, and nudging it from the keyboard.
 *
 * Pure, and in canvas pixels throughout. The overlay that turns pointer movement
 * into a delta owns the preview's scale; this owns what a delta does to a stored
 * top-left rectangle, and the snapping that makes edges and centres easy to hit.
 */

export type ManipulationHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const satisfies readonly ManipulationHandle[];

/** The smallest a rectangle is ever resized to, in canvas pixels. */
const MIN_SIZE = 1;

export interface SnapLines {
	/** Canvas x positions an edge or centre may snap to. */
	x: readonly number[];
	/** Canvas y positions an edge or centre may snap to. */
	y: readonly number[];
}

export interface ManipulationOptions {
	/** Keep the starting width-to-height ratio while resizing. */
	keepRatio?: boolean;
	/** Lines to snap to, and how close, in canvas pixels, counts as on one. */
	snap?: { lines: SnapLines; threshold: number };
}

export interface ManipulationResult {
	rect: GraphicRect;
	/** The snap lines the result landed on, for the overlay to draw. */
	snapped: { x?: number; y?: number };
}

/** The canvas's own edges and centre lines. */
export function canvasSnapLines(canvas: { width: number; height: number }): SnapLines {
	return {
		x: [0, canvas.width / 2, canvas.width],
		y: [0, canvas.height / 2, canvas.height],
	};
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
		const snapX = nearest([x, x + start.width / 2, x + start.width], lines.x, threshold);
		const snapY = nearest([y, y + start.height / 2, y + start.height], lines.y, threshold);
		if (snapX) {
			x += snapX.offset;
			snapped.x = snapX.line;
		}
		if (snapY) {
			y += snapY.offset;
			snapped.y = snapY.line;
		}
	}
	return { rect: round({ ...start, x, y }), snapped };
}

function resizeRect(
	start: GraphicRect,
	handle: Exclude<ManipulationHandle, 'move'>,
	delta: { x: number; y: number },
	options: ManipulationOptions,
): ManipulationResult {
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
		const horizontal = handle.includes('w') ? 'left' : handle.includes('e') ? 'right' : undefined;
		const vertical = handle.includes('n') ? 'top' : handle.includes('s') ? 'bottom' : undefined;
		if (horizontal) {
			const edge = nearest([horizontal === 'left' ? left : right], snap.lines.x, snap.threshold);
			if (edge) {
				if (horizontal === 'left')
					left = Math.min(left + edge.offset, right - MIN_SIZE);
				else
					right = Math.max(right + edge.offset, left + MIN_SIZE);
				snapped.x = edge.line;
			}
		}
		if (vertical) {
			const edge = nearest([vertical === 'top' ? top : bottom], snap.lines.y, snap.threshold);
			if (edge) {
				if (vertical === 'top')
					top = Math.min(top + edge.offset, bottom - MIN_SIZE);
				else
					bottom = Math.max(bottom + edge.offset, top + MIN_SIZE);
				snapped.y = edge.line;
			}
		}
	}

	let rect: GraphicRect = { x: left, y: top, width: right - left, height: bottom - top };

	// A corner keeps the ratio by following whichever axis moved further; an edge
	// handle keeps it by growing the other axis about the rectangle's centre line.
	if (options.keepRatio && start.width > 0 && start.height > 0) {
		const ratio = start.width / start.height;
		const corner = handle.length === 2;
		const widthLeads = corner
			? Math.abs(rect.width - start.width) / start.width >= Math.abs(rect.height - start.height) / start.height
			: handle === 'e' || handle === 'w';
		const width = widthLeads ? rect.width : rect.height * ratio;
		const height = widthLeads ? rect.width / ratio : rect.height;
		const x = handle.includes('w')
			? right - width
			: corner || handle === 'e' ? left : start.x + (start.width - width) / 2;
		const y = handle.includes('n')
			? bottom - height
			: corner || handle === 's' ? top : start.y + (start.height - height) / 2;
		rect = { x, y, width, height };
		// A kept ratio decides the size, so a snap it overrode is not shown.
		delete snapped.x;
		delete snapped.y;
	}

	return { rect: round(rect), snapped };
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

/** The rectangle an arrow-key nudge produces. */
export function nudgeRect(rect: GraphicRect, delta: { x: number; y: number }): GraphicRect {
	return { ...rect, x: Math.round(rect.x + delta.x), y: Math.round(rect.y + delta.y) };
}
