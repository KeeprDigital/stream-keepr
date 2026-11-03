import { describe, expect, it } from 'vitest';
import { canvasSnapLines, dragRotation, manipulateRect, neighbourGaps, nudgeRect } from '~~/app/modules/graphics/canvasManipulation';

/**
 * Direct manipulation on an editor canvas: what a drag from one handle does to a
 * stored top-left rectangle, in canvas pixels.
 */

const RECT = {
	x: 100,
	y: 100,
	width: 200,
	height: 100,
};
const SNAP = {
	lines: canvasSnapLines({ width: 1920, height: 1080 }),
	threshold: 6,
};

describe('canvas manipulation', () => {
	it('moves a rectangle by the drag, in whole pixels', () => {
		expect(manipulateRect(RECT, 'move', { x: 10.4, y: -20.6 }).rect).toEqual({
			x: 110,
			y: 79,
			width: 200,
			height: 100,
		});
	});

	it('resizes from each edge and corner, keeping the opposite side where it was', () => {
		expect(manipulateRect(RECT, 'e', { x: 50, y: 99 }).rect).toEqual({
			x: 100,
			y: 100,
			width: 250,
			height: 100,
		});
		expect(manipulateRect(RECT, 'w', { x: 50, y: 0 }).rect).toEqual({
			x: 150,
			y: 100,
			width: 150,
			height: 100,
		});
		expect(manipulateRect(RECT, 'n', { x: 0, y: -40 }).rect).toEqual({
			x: 100,
			y: 60,
			width: 200,
			height: 140,
		});
		expect(manipulateRect(RECT, 'se', { x: 10, y: 20 }).rect).toEqual({
			x: 100,
			y: 100,
			width: 210,
			height: 120,
		});
		expect(manipulateRect(RECT, 'nw', { x: 10, y: 20 }).rect).toEqual({
			x: 110,
			y: 120,
			width: 190,
			height: 80,
		});
	});

	it('never resizes below one pixel, however far the handle goes past the other side', () => {
		expect(manipulateRect(RECT, 'e', { x: -500, y: 0 }).rect).toMatchObject({ x: 100, width: 1 });
		expect(manipulateRect(RECT, 'n', { x: 0, y: 500 }).rect).toMatchObject({ y: 199, height: 1 });
	});

	it('keeps the starting aspect ratio when asked', () => {
		expect(manipulateRect(RECT, 'se', { x: 200, y: 0 }, { keepRatio: true }).rect).toEqual({
			x: 100,
			y: 100,
			width: 400,
			height: 200,
		});
		expect(manipulateRect(RECT, 'nw', { x: -200, y: 0 }, { keepRatio: true }).rect).toEqual({
			x: -100,
			y: 0,
			width: 400,
			height: 200,
		});
		// An edge handle grows the other axis about the centre line.
		expect(manipulateRect(RECT, 'e', { x: 200, y: 0 }, { keepRatio: true }).rect).toEqual({
			x: 100,
			y: 50,
			width: 400,
			height: 200,
		});
	});

	it('snaps a moving edge or centre to the canvas edges and centre lines', () => {
		const left = manipulateRect(RECT, 'move', { x: -96, y: 0 }, { snap: SNAP });
		expect(left.rect.x).toBe(0);
		expect(left.snapped).toEqual({ x: 0 });

		// The rectangle's centre lands on the canvas's horizontal centre.
		const centred = manipulateRect(RECT, 'move', { x: 0, y: 388 }, { snap: SNAP });
		expect(centred.rect.y).toBe(490);
		expect(centred.snapped).toEqual({ y: 540 });

		const resized = manipulateRect(RECT, 'e', { x: 1617, y: 0 }, { snap: SNAP });
		expect(resized.rect).toMatchObject({ x: 100, width: 1820 });
		expect(resized.snapped).toEqual({ x: 1920 });
	});

	// A quarter turn about the centre covers x 150–250, y 50–250.
	it.each([
		{
			name: 'moves by the box it covers, so its covered left edge lands on the line',
			handle: 'move' as const,
			delta: { x: -146, y: 0 },
			rect: {
				x: -50,
				y: 100,
				width: 200,
				height: 100,
			},
			snapped: { x: 0 },
		},
		{
			name: 'resizes without snapping',
			handle: 'e' as const,
			delta: { x: 0, y: 1618 },
			rect: {
				x: -709,
				y: 909,
				width: 1818,
				height: 100,
			},
			snapped: {},
		},
	])('a rotated rectangle $name', ({ handle, delta, rect, snapped }) => {
		const result = manipulateRect(RECT, handle, delta, { snap: SNAP, rotation: 90, anchor: 'center' });
		expect(result).toEqual({ rect, snapped });
	});

	// A rotated rectangle resizes along its own axes, and the handle opposite the dragged one stays
	// where it is drawn, wherever its Graphic Anchor Point is.
	it.each([
		{
			name: 'an edge, a quarter turn about the centre, dragged along the turned width',
			rotation: 90,
			anchor: 'center' as const,
			handle: 'e' as const,
			delta: { x: 0, y: 50 },
			rect: {
				x: 75,
				y: 125,
				width: 250,
				height: 100,
			},
		},
		{
			name: 'an edge, a half turn about the centre, dragged left',
			rotation: 180,
			anchor: 'center' as const,
			handle: 'e' as const,
			delta: { x: -50, y: 0 },
			rect: {
				x: 50,
				y: 100,
				width: 250,
				height: 100,
			},
		},
		{
			name: 'a corner, a quarter turn about the centre',
			rotation: 90,
			anchor: 'center' as const,
			handle: 'nw' as const,
			delta: { x: 0, y: -40 },
			rect: {
				x: 80,
				y: 80,
				width: 240,
				height: 100,
			},
		},
		{
			name: 'a corner, a quarter turn about the opposite corner',
			rotation: 90,
			anchor: 'top-left' as const,
			handle: 'se' as const,
			delta: { x: -20, y: 30 },
			rect: {
				x: 100,
				y: 100,
				width: 230,
				height: 120,
			},
		},
		{
			name: 'an edge keeping its ratio, a quarter turn about the centre',
			rotation: 90,
			anchor: 'center' as const,
			handle: 'e' as const,
			delta: { x: 0, y: 100 },
			keepRatio: true,
			rect: {
				x: 50,
				y: 125,
				width: 300,
				height: 150,
			},
		},
	])('resizes a rotated rectangle by $name', ({ rotation, anchor, handle, delta, keepRatio, rect }) => {
		expect(manipulateRect(RECT, handle, delta, { rotation, anchor, keepRatio }).rect).toEqual(rect);
	});

	// The rotation a drag around the Graphic Anchor Point turns to, from where it started.
	it.each([
		{
			name: 'turns by the angle swept about the anchor',
			anchor: 'center' as const,
			rotation: 0,
			to: { x: 200, y: 250 },
			expected: 90,
		},
		{
			name: 'adds the sweep to the rotation it started at',
			anchor: 'center' as const,
			rotation: 30,
			to: { x: 200, y: 250 },
			expected: 120,
		},
		{
			name: 'sweeps about the item\'s own anchor',
			anchor: 'top-left' as const,
			rotation: 0,
			from: { x: 200, y: 100 },
			to: { x: 100, y: 200 },
			expected: 90,
		},
		{
			name: 'turns in whole degrees',
			anchor: 'center' as const,
			rotation: 0,
			to: { x: 293.97, y: 184.2 },
			expected: 20,
		},
		{
			name: 'steps in 15 degree increments when asked',
			anchor: 'center' as const,
			rotation: 0,
			to: { x: 293.97, y: 184.2 },
			step: 15,
			expected: 15,
		},
		{
			name: 'keeps the rotation it started at, past half a turn',
			anchor: 'center' as const,
			rotation: 170,
			to: { x: 200, y: 250 },
			expected: 260,
		},
		{
			name: 'wraps past a whole turn to stay within one',
			anchor: 'center' as const,
			rotation: 350,
			to: { x: 200, y: 250 },
			expected: 80,
		},
		{
			name: 'leaves a rotation the pointer has not turned as it was',
			anchor: 'center' as const,
			rotation: 12.5,
			to: { x: 300.2, y: 150 },
			expected: 12.5,
		},
		{
			name: 'sweeps the shorter way round past the side behind the anchor',
			anchor: 'center' as const,
			rotation: 0,
			from: { x: 100, y: 140 },
			to: { x: 100, y: 160 },
			expected: -11,
		},
	])('a rotate drag $name', ({ anchor, rotation, from, to, step, expected }) => {
		expect(dragRotation({ rect: RECT, rotation, anchor }, from ?? { x: 300, y: 150 }, to, { step })).toBe(expected);
	});

	it('does not snap from beyond the threshold', () => {
		const result = manipulateRect(RECT, 'move', { x: -90, y: 0 }, { snap: SNAP });
		expect(result.rect.x).toBe(10);
		expect(result.snapped).toEqual({});
	});

	describe('snap lines', () => {
		const CANVAS = { width: 1000, height: 500 };
		const layer = (id: string, rect: { x: number; y: number; width: number; height: number }, extra: object = {}) => ({
			id,
			visible: true,
			...rect,
			...extra,
		});

		it.each([
			{
				name: 'a visible neighbour adds its edges and centre',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('other', {
						x: 100,
						y: 50,
						width: 200,
						height: 100,
					}),
				],
				x: [0, 100, 200, 300, 500, 1000],
				y: [0, 50, 100, 150, 250, 500],
			},
			{
				name: 'a hidden neighbour adds nothing',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('other', {
						x: 100,
						y: 50,
						width: 200,
						height: 100,
					}, { visible: false }),
				],
				x: [0, 500, 1000],
				y: [0, 250, 500],
			},
			{
				name: 'the moving layer adds nothing of its own',
				layers: [
					layer('self', {
						x: 100,
						y: 50,
						width: 200,
						height: 100,
					}),
				],
				x: [0, 500, 1000],
				y: [0, 250, 500],
			},
			{
				name: 'a neighbour rotated about its centre adds its axis-aligned bounds',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('other', {
						x: 100,
						y: 100,
						width: 200,
						height: 100,
					}, { rotation: 90, anchor: 'center' }),
				],
				x: [0, 150, 200, 250, 500, 1000],
				y: [0, 50, 150, 250, 500],
			},
			{
				name: 'a neighbour rotated about its top-left corner adds the bounds it swings into',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('other', {
						x: 100,
						y: 100,
						width: 200,
						height: 100,
					}, { rotation: 90, anchor: 'top-left' }),
				],
				x: [0, 50, 100, 500, 1000],
				y: [0, 100, 200, 250, 300, 500],
			},
			{
				name: 'a neighbour at 45 degrees adds the bounds of its corners',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('other', {
						x: 100,
						y: 100,
						width: 100,
						height: 100,
					}, { rotation: 45, anchor: 'center' }),
				],
				x: [0, 79.29, 150, 220.71, 500, 1000],
				y: [0, 79.29, 150, 220.71, 250, 500],
			},
			{
				name: 'a group child takes its visible siblings, its group box and the canvas, in group space',
				layers: [
					layer('outside', {
						x: 700,
						y: 300,
						width: 100,
						height: 100,
					}),
					layer('cluster', {
						x: 100,
						y: 50,
						width: 400,
						height: 200,
					}, {
						padding: 10,
						children: [
							layer('self', { x: 0, y: 0, width: 10, height: 10 }),
							layer('sibling', { x: 20, y: 30, width: 40, height: 20 }),
							layer('hidden', {
								x: 300,
								y: 150,
								width: 10,
								height: 10,
							}, { visible: false }),
						],
					}),
				],
				x: [
					-110,
					-10,
					0,
					20,
					40,
					60,
					190,
					380,
					390,
					890,
				],
				y: [
					-60,
					-10,
					0,
					30,
					40,
					50,
					90,
					180,
					190,
					440,
				],
			},
			{
				name: 'a canvas-arranged group\'s visible children add their edges and centres, in canvas pixels',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('cluster', {
						x: 100,
						y: 50,
						width: 400,
						height: 200,
					}, {
						arrangement: 'canvas',
						padding: 10,
						children: [
							layer('child', { x: 20, y: 30, width: 40, height: 20 }),
							layer('hidden', {
								x: 300,
								y: 150,
								width: 10,
								height: 10,
							}, { visible: false }),
						],
					}),
				],
				x: [0, 100, 130, 150, 170, 300, 500, 1000],
				y: [0, 50, 90, 100, 110, 150, 250, 500],
			},
			{
				name: 'a row group\'s children add nothing, since the group places them',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('cluster', {
						x: 100,
						y: 50,
						width: 400,
						height: 200,
					}, {
						arrangement: 'row',
						padding: 10,
						children: [
							layer('child', { x: 20, y: 30, width: 40, height: 20 }),
						],
					}),
				],
				x: [0, 100, 300, 500, 1000],
				y: [0, 50, 150, 250, 500],
			},
			{
				name: 'a rotated group\'s children add nothing, since they turn with it',
				layers: [
					layer('self', { x: 0, y: 0, width: 10, height: 10 }),
					layer('cluster', {
						x: 100,
						y: 50,
						width: 400,
						height: 200,
					}, {
						arrangement: 'canvas',
						rotation: 90,
						anchor: 'center',
						padding: 10,
						children: [
							layer('child', { x: 20, y: 30, width: 40, height: 20 }),
						],
					}),
				],
				x: [0, 200, 300, 400, 500, 1000],
				y: [-50, 0, 150, 250, 350, 500],
			},
			{
				name: 'a child of a hidden group snaps to the canvas only',
				layers: [
					layer('cluster', {
						x: 100,
						y: 50,
						width: 400,
						height: 200,
					}, {
						visible: false,
						arrangement: 'canvas',
						padding: 10,
						children: [
							layer('self', { x: 0, y: 0, width: 10, height: 10 }),
							layer('sibling', { x: 20, y: 30, width: 40, height: 20 }),
						],
					}),
				],
				x: [-110, 390, 890],
				y: [-60, 190, 440],
			},
		])('$name', ({ layers, x, y }) => {
			const lines = canvasSnapLines(CANVAS, layers, 'self');
			expect({ x: lines.x, y: lines.y }).toEqual({ x, y });
		});

		// Several layers move as one, in canvas pixels (#740).
		it.each([
			{
				name: 'none of the moving layers adds anything, a group child among them included',
				moving: ['self', 'child'],
				x: [0, 100, 300, 350, 400, 500, 1000],
				y: [0, 50, 150, 250, 300, 350, 400, 500],
			},
			{
				name: 'a moving group\'s children move with it, and add nothing',
				moving: ['self', 'cluster'],
				x: [0, 300, 350, 400, 500, 1000],
				y: [0, 250, 300, 350, 400, 500],
			},
			{
				name: 'a group child that is not moving still adds its edges',
				moving: ['self', 'other'],
				x: [0, 100, 130, 150, 170, 300, 500, 1000],
				y: [0, 50, 90, 100, 110, 150, 250, 500],
			},
		])('$name', ({ moving, x, y }) => {
			const layers = [
				layer('self', { x: 0, y: 0, width: 10, height: 10 }),
				layer('other', {
					x: 300,
					y: 300,
					width: 100,
					height: 100,
				}),
				layer('cluster', {
					x: 100,
					y: 50,
					width: 400,
					height: 200,
				}, {
					arrangement: 'canvas',
					padding: 10,
					children: [
						layer('child', { x: 20, y: 30, width: 40, height: 20 }),
					],
				}),
			];
			const lines = canvasSnapLines(CANVAS, layers, moving);
			expect({ x: lines.x, y: lines.y }).toEqual({ x, y });
		});
	});

	describe('neighbour gaps', () => {
		const BOX = {
			x: 100,
			y: 100,
			width: 100,
			height: 100,
		};

		// `at` is the middle of the span the two share across the gap, where the readout is drawn.
		it.each([
			{
				name: 'measures to a neighbour beside it',
				neighbours: [
					{
						x: 250,
						y: 120,
						width: 50,
						height: 50,
					},
				],
				gaps: {
					x: { from: 200, to: 250, at: 145 },
				},
			},
			{
				name: 'measures to the nearer of two neighbours on one axis',
				neighbours: [
					{ x: 0, y: 100, width: 80, height: 100 },
					{
						x: 230,
						y: 100,
						width: 10,
						height: 10,
					},
				],
				gaps: {
					x: { from: 80, to: 100, at: 150 },
				},
			},
			{
				name: 'measures above or below on the other axis',
				neighbours: [
					{
						x: 150,
						y: 260,
						width: 100,
						height: 40,
					},
				],
				gaps: {
					y: { from: 200, to: 260, at: 175 },
				},
			},
			{
				name: 'ignores a neighbour that is only diagonal to it',
				neighbours: [
					{
						x: 300,
						y: 300,
						width: 50,
						height: 50,
					},
				],
				gaps: {},
			},
			{
				name: 'ignores a neighbour it overlaps or touches',
				neighbours: [
					{
						x: 150,
						y: 150,
						width: 100,
						height: 100,
					},
					{
						x: 200,
						y: 100,
						width: 10,
						height: 10,
					},
				],
				gaps: {},
			},
		])('$name', ({ neighbours, gaps }) => {
			expect(neighbourGaps(BOX, neighbours)).toEqual(gaps);
		});

		it('measures a group child against its visible siblings only, not its group box or the canvas', () => {
			const lines = canvasSnapLines({ width: 1000, height: 500 }, [
				{
					id: 'outside',
					visible: true,
					x: 600,
					y: 0,
					width: 10,
					height: 500,
				},
				{
					id: 'cluster',
					visible: true,
					x: 0,
					y: 0,
					width: 500,
					height: 500,
					padding: 0,
					children: [
						{ id: 'self', visible: true, ...BOX },
						{
							id: 'hidden',
							visible: false,
							x: 210,
							y: 100,
							width: 10,
							height: 10,
						},
						{
							id: 'sibling',
							visible: true,
							x: 230,
							y: 100,
							width: 10,
							height: 10,
							rotation: 90,
							anchor: 'top-left' as const,
						},
					],
				},
			], 'self');

			expect(neighbourGaps(BOX, lines.neighbours ?? [])).toEqual({
				x: { from: 200, to: 220, at: 105 },
			});
		});
	});

	it('nudges by whole pixels', () => {
		expect(nudgeRect(RECT, { x: -10, y: 1 })).toEqual({
			x: 90,
			y: 101,
			width: 200,
			height: 100,
		});
	});
});
