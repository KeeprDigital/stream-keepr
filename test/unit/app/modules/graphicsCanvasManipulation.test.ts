import { describe, expect, it } from 'vitest';
import { canvasSnapLines, manipulateRect, nudgeRect } from '~~/app/modules/graphics/canvasManipulation';

/**
 * Direct manipulation on an editor canvas: what a drag from one handle does to a
 * stored top-left rectangle, in canvas pixels.
 */

const RECT = { x: 100, y: 100, width: 200, height: 100 };
const SNAP = { lines: canvasSnapLines({ width: 1920, height: 1080 }), threshold: 6 };

describe('canvas manipulation', () => {
	it('moves a rectangle by the drag, in whole pixels', () => {
		expect(manipulateRect(RECT, 'move', { x: 10.4, y: -20.6 }).rect).toEqual({ x: 110, y: 79, width: 200, height: 100 });
	});

	it('resizes from each edge and corner, keeping the opposite side where it was', () => {
		expect(manipulateRect(RECT, 'e', { x: 50, y: 99 }).rect).toEqual({ x: 100, y: 100, width: 250, height: 100 });
		expect(manipulateRect(RECT, 'w', { x: 50, y: 0 }).rect).toEqual({ x: 150, y: 100, width: 150, height: 100 });
		expect(manipulateRect(RECT, 'n', { x: 0, y: -40 }).rect).toEqual({ x: 100, y: 60, width: 200, height: 140 });
		expect(manipulateRect(RECT, 'se', { x: 10, y: 20 }).rect).toEqual({ x: 100, y: 100, width: 210, height: 120 });
		expect(manipulateRect(RECT, 'nw', { x: 10, y: 20 }).rect).toEqual({ x: 110, y: 120, width: 190, height: 80 });
	});

	it('never resizes below one pixel, however far the handle goes past the other side', () => {
		expect(manipulateRect(RECT, 'e', { x: -500, y: 0 }).rect).toMatchObject({ x: 100, width: 1 });
		expect(manipulateRect(RECT, 'n', { x: 0, y: 500 }).rect).toMatchObject({ y: 199, height: 1 });
	});

	it('keeps the starting aspect ratio when asked', () => {
		expect(manipulateRect(RECT, 'se', { x: 200, y: 0 }, { keepRatio: true }).rect).toEqual({ x: 100, y: 100, width: 400, height: 200 });
		expect(manipulateRect(RECT, 'nw', { x: -200, y: 0 }, { keepRatio: true }).rect).toEqual({ x: -100, y: 0, width: 400, height: 200 });
		// An edge handle grows the other axis about the centre line.
		expect(manipulateRect(RECT, 'e', { x: 200, y: 0 }, { keepRatio: true }).rect).toEqual({ x: 100, y: 50, width: 400, height: 200 });
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

	it('does not snap from beyond the threshold', () => {
		const result = manipulateRect(RECT, 'move', { x: -90, y: 0 }, { snap: SNAP });
		expect(result.rect.x).toBe(10);
		expect(result.snapped).toEqual({});
	});

	it('nudges by whole pixels', () => {
		expect(nudgeRect(RECT, { x: -10, y: 1 })).toEqual({ x: 90, y: 101, width: 200, height: 100 });
	});
});
