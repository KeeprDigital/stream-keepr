import { describe, expect, it } from 'vitest';
import {
	alignGraphicRect,
	anchoredGraphicPosition,
	displayGeometryValue,
	moveGraphicRectToAnchoredPosition,
	parseGeometryValue,
	resizeGraphicRectFromAnchor,
} from '~~/shared/modules/graphics';

const rect = { x: 100, y: 200, width: 400, height: 100 };

describe('graphicsGeometry', () => {
	it('reports the coordinate of the selected Graphic Anchor Point', () => {
		expect(anchoredGraphicPosition(rect, 'top-left')).toEqual({ x: 100, y: 200 });
		expect(anchoredGraphicPosition(rect, 'center')).toEqual({ x: 300, y: 250 });
		expect(anchoredGraphicPosition(rect, 'bottom-right')).toEqual({ x: 500, y: 300 });
	});

	it('moves the stored top-left rectangle so the anchored coordinate lands where the author typed it', () => {
		expect(moveGraphicRectToAnchoredPosition(rect, 'x', 960, 'center')).toEqual({ x: 760 });
		expect(moveGraphicRectToAnchoredPosition(rect, 'y', 1080, 'bottom')).toEqual({ y: 980 });
	});

	it('holds the Graphic Anchor Point fixed while the item is resized', () => {
		const resized = resizeGraphicRectFromAnchor(rect, { width: 200, height: 50 }, 'center');

		expect(anchoredGraphicPosition(resized, 'center')).toEqual(anchoredGraphicPosition(rect, 'center'));
		expect(resized).toEqual({ x: 200, y: 225, width: 200, height: 50 });
	});

	it('leaves the top-left corner alone when resizing from the top-left anchor', () => {
		expect(resizeGraphicRectFromAnchor(rect, { width: 800 }, 'top-left')).toEqual({
			x: 100,
			y: 200,
			width: 800,
			height: 100,
		});
	});

	it('projects canonical pixels into the Geometry Unit the author works in', () => {
		expect(displayGeometryValue(960, 1920, 'px')).toBe(960);
		expect(displayGeometryValue(960, 1920, 'percent')).toBe(50);
		expect(displayGeometryValue(960, 1920, 'grid', true)).toBe(0);
		expect(displayGeometryValue(960, 1920, 'grid')).toBe(16);
	});

	it('reads an authored value in each unit back into the canonical pixels it names', () => {
		// Anchored per unit: a quarter of a 1920px canvas is 480px, which is 25% and
		// is 8 of 32 grid units, so -8 on the centred grid.
		expect(parseGeometryValue(480, 1920, 'px', true)).toBe(480);
		expect(parseGeometryValue(25, 1920, 'percent', true)).toBe(480);
		expect(parseGeometryValue(-8, 1920, 'grid', true)).toBe(480);

		// A size is not offset by the grid's centre, so the same 480px reads as 8.
		expect(parseGeometryValue(8, 1920, 'grid')).toBe(480);
		expect(displayGeometryValue(480, 1920, 'grid')).toBe(8);
		expect(displayGeometryValue(480, 1920, 'grid', true)).toBe(-8);
	});

	it('rounds an authored value to whole canonical pixels', () => {
		expect(parseGeometryValue(33.333, 1920, 'percent')).toBe(640);
		expect(parseGeometryValue(10.4, 1920, 'px')).toBe(10);
	});

	it('reads a cleared or non-numeric entry as zero pixels', () => {
		expect(parseGeometryValue(Number.NaN, 1920, 'percent')).toBe(0);
		expect(parseGeometryValue(Number.POSITIVE_INFINITY, 1920, 'px')).toBe(0);
	});

	it('shows a percentage to two decimal places', () => {
		expect(displayGeometryValue(333, 1920, 'percent')).toBe(17.34);
		expect(parseGeometryValue(17.34375, 1920, 'percent')).toBe(333);
	});

	it('rounds a resized width and height to whole pixels around the anchor', () => {
		const odd = { x: 100, y: 50, width: 321, height: 181 };

		expect(resizeGraphicRectFromAnchor(odd, { width: 400.4 }, 'right')).toEqual({ x: 21, y: 50, width: 400, height: 181 });
		expect(resizeGraphicRectFromAnchor(odd, { height: 200.4 }, 'bottom')).toEqual({ x: 100, y: 31, width: 321, height: 200 });
	});

	it('aligns a rectangle\'s edge or centre with its container\'s, whatever its anchor', () => {
		// A 401×201 item on a 1920×1080 canvas.
		const item = { x: 100, y: 50, width: 401, height: 201 };
		const canvas = { width: 1920, height: 1080 };

		expect(alignGraphicRect(item, 'x', 'start', canvas)).toEqual({ x: 0 });
		expect(alignGraphicRect(item, 'x', 'center', canvas)).toEqual({ x: 759.5 });
		expect(alignGraphicRect(item, 'x', 'end', canvas)).toEqual({ x: 1519 });
		expect(alignGraphicRect(item, 'y', 'start', canvas)).toEqual({ y: 0 });
		expect(alignGraphicRect(item, 'y', 'center', canvas)).toEqual({ y: 439.5 });
		expect(alignGraphicRect(item, 'y', 'end', canvas)).toEqual({ y: 879 });
		// Rounded to the geometry precision used everywhere else.
		expect(alignGraphicRect({ ...item, width: 400.333 }, 'x', 'center', canvas)).toEqual({ x: 759.83 });
	});
});
