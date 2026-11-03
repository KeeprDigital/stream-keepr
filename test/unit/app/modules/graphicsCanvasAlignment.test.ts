import type { AlignEdge } from '~~/app/modules/graphics/canvasAlignment';
import type { GraphicRect } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { alignBoxes, distributeBoxes } from '~~/app/modules/graphics/canvasAlignment';

/**
 * Aligning and distributing boxes on an editor canvas: how far each box moves,
 * in whole pixels of its container.
 */

function box(x: number, y: number, width: number, height: number): GraphicRect {
	return { x, y, width, height };
}

// They cover (100, 50) to (400, 300).
const THREE = [
	box(100, 50, 100, 40),
	box(250, 120, 50, 80),
	box(180, 260, 220, 40),
];

describe('canvas alignment', () => {
	it.each<[AlignEdge, { x: number; y: number }[]]>([
		[
			'left',
			[
				{ x: 0, y: 0 },
				{ x: -150, y: 0 },
				{ x: -80, y: 0 },
			],
		],
		[
			'center',
			[
				{ x: 100, y: 0 },
				{ x: -25, y: 0 },
				{ x: -40, y: 0 },
			],
		],
		[
			'right',
			[
				{ x: 200, y: 0 },
				{ x: 100, y: 0 },
				{ x: 0, y: 0 },
			],
		],
		[
			'top',
			[
				{ x: 0, y: 0 },
				{ x: 0, y: -70 },
				{ x: 0, y: -210 },
			],
		],
		[
			'middle',
			[
				{ x: 0, y: 105 },
				{ x: 0, y: 15 },
				{ x: 0, y: -105 },
			],
		],
		[
			'bottom',
			[
				{ x: 0, y: 210 },
				{ x: 0, y: 100 },
				{ x: 0, y: 0 },
			],
		],
	])('aligns several boxes\' %s to the bounds they cover together', (edge, moves) => {
		expect(alignBoxes(THREE, edge)).toEqual(moves);
	});

	it.each<[AlignEdge, { x: number; y: number }]>([
		[
			'left',
			{ x: -100, y: 0 },
		],
		[
			'center',
			{ x: 810, y: 0 },
		],
		[
			'right',
			{ x: 1720, y: 0 },
		],
		[
			'top',
			{ x: 0, y: -50 },
		],
		[
			'middle',
			{ x: 0, y: 470 },
		],
		[
			'bottom',
			{ x: 0, y: 990 },
		],
	])('aligns a box\'s %s to the container it is given', (edge, move) => {
		expect(alignBoxes([THREE[0]!], edge, box(0, 0, 1920, 1080))).toEqual([move]);
	});

	it.each<[string, GraphicRect[], AlignEdge, { x: number; y: number }[]]>([
		[
			'rounds a centre that falls between pixels',
			[
				box(0, 0, 10, 10),
				box(0, 0, 3, 10),
			],
			'center',
			[
				{ x: 0, y: 0 },
				{ x: 4, y: 0 },
			],
		],
		[
			'moves a fractional box by whole pixels',
			[
				box(10.25, 0, 20, 10),
				box(40, 0, 10, 10),
			],
			'right',
			[
				{ x: 20, y: 0 },
				{ x: 0, y: 0 },
			],
		],
	])('%s', (_, boxes, edge, moves) => {
		expect(alignBoxes(boxes, edge)).toEqual(moves);
	});

	it.each<['x' | 'y', GraphicRect[], { x: number; y: number }[]]>([
		// 350 wide, 200 of boxes: three gaps of 50.
		[
			'x',
			[
				box(0, 0, 50, 10),
				box(60, 30, 50, 10),
				box(300, 0, 50, 10),
				box(100, 90, 50, 10),
			],
			[
				{ x: 0, y: 0 },
				{ x: 40, y: 0 },
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			],
		],
		// Taken in order of their centres, whatever order they were chosen in.
		[
			'x',
			[
				box(375, 0, 100, 10),
				box(0, 0, 100, 10),
				box(110, 0, 100, 10),
				box(150, 0, 100, 10),
			],
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 0 },
				{ x: 15, y: 0 },
				{ x: 100, y: 0 },
			],
		],
		[
			'y',
			[
				box(0, 0, 10, 20),
				box(0, 25, 10, 20),
				box(0, 100, 10, 20),
			],
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 25 },
				{ x: 0, y: 0 },
			],
		],
	])('distributes along %s, spacing the boxes evenly between the outermost two', (axis, boxes, moves) => {
		expect(distributeBoxes(boxes, axis)).toEqual(moves);
	});

	it.each([0, 1, 2])('moves none of %i boxes to distribute', (count) => {
		const boxes = THREE.slice(0, count);

		expect(distributeBoxes(boxes, 'x')).toEqual(boxes.map(() => ({ x: 0, y: 0 })));
	});
});
