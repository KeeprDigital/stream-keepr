import type { GraphicRect } from '~~/shared/types/graphics';

/**
 * Aligning and distributing boxes on an editor canvas (#919).
 *
 * Pure, and in one container's pixels throughout. Each box is what a layer
 * covers, a rotated one the axis-aligned box it turns into, as snapping sees it;
 * the answer is how far to move each, in whole pixels, which moves its stored
 * rectangle by as much.
 */

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export type DistributeAxis = 'x' | 'y';

export interface BoxMove {
	x: number;
	y: number;
}

const ALIGN: Record<AlignEdge, { axis: DistributeAxis; at: 0 | 0.5 | 1 }> = {
	left: { axis: 'x', at: 0 },
	center: { axis: 'x', at: 0.5 },
	right: { axis: 'x', at: 1 },
	top: { axis: 'y', at: 0 },
	middle: { axis: 'y', at: 0.5 },
	bottom: { axis: 'y', at: 1 },
};

function sizeOf(axis: DistributeAxis) {
	return axis === 'x'
		? 'width'
		: 'height';
}

function along(axis: DistributeAxis, distance: number): BoxMove {
	// `+ 0` keeps a rounded -0 from reading as a move.
	const whole = Math.round(distance) + 0;
	return axis === 'x'
		? { x: whole, y: 0 }
		: { x: 0, y: whole };
}

/** The box several boxes cover together. */
export function unionBox(boxes: readonly GraphicRect[]): GraphicRect {
	const left = Math.min(...boxes.map(rect => rect.x));
	const top = Math.min(...boxes.map(rect => rect.y));
	return {
		x: left,
		y: top,
		width: Math.max(...boxes.map(rect => rect.x + rect.width)) - left,
		height: Math.max(...boxes.map(rect => rect.y + rect.height)) - top,
	};
}

/**
 * Line every box's edge or centre up with the same edge or centre of `to`: the
 * container for one box, and by default the bounds the boxes cover together.
 */
export function alignBoxes(boxes: readonly GraphicRect[], edge: AlignEdge, to?: GraphicRect): BoxMove[] {
	if (boxes.length === 0)
		return [];
	const { axis, at } = ALIGN[edge];
	const size = sizeOf(axis);
	const target = to ?? unionBox(boxes);
	const line = target[axis] + target[size] * at;
	return boxes.map(rect => along(axis, line - (rect[axis] + rect[size] * at)));
}

/**
 * Space the boxes evenly along an axis: taken in order of their centres, the
 * outermost two stay, and those between them move so every gap between
 * neighbours is the same. Fewer than three have nothing to space.
 */
export function distributeBoxes(boxes: readonly GraphicRect[], axis: DistributeAxis): BoxMove[] {
	const moves = boxes.map(() => ({ x: 0, y: 0 }));
	if (boxes.length < 3)
		return moves;
	const size = sizeOf(axis);
	const order = boxes
		.map((rect, index) => ({ rect, index }))
		.sort((a, b) => (a.rect[axis] + a.rect[size] / 2) - (b.rect[axis] + b.rect[size] / 2));
	const first = order[0]!.rect;
	const last = order.at(-1)!.rect;
	const between = order.slice(1, -1);
	const filled = between.reduce((sum, { rect }) => sum + rect[size], 0);
	const gap = (last[axis] - (first[axis] + first[size]) - filled) / (order.length - 1);
	let cursor = first[axis] + first[size] + gap;
	for (const { rect, index } of between) {
		moves[index] = along(axis, cursor - rect[axis]);
		cursor += rect[size] + gap;
	}
	return moves;
}
