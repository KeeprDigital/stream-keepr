import { describe, expect, it } from 'vitest';
import {
	anchoredGraphicPosition,
	displayGraphicGeometryValue,
	moveGraphicRectToAnchoredPosition,
	parseGraphicGeometryValue,
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

	it('projects canonical pixels into the Graphic Geometry Unit the author works in', () => {
		expect(displayGraphicGeometryValue(960, 1920, 'px')).toBe(960);
		expect(displayGraphicGeometryValue(960, 1920, 'percent')).toBe(50);
		expect(displayGraphicGeometryValue(960, 1920, 'grid', true)).toBe(0);
		expect(displayGraphicGeometryValue(960, 1920, 'grid')).toBe(16);
	});

	it('reads an authored value in each unit back into the canonical pixels it names', () => {
		// Anchored per unit: a quarter of a 1920px canvas is 480px, which is 25% and
		// is 8 of 32 grid units, so -8 on the centred grid.
		expect(parseGraphicGeometryValue(480, 1920, 'px', true)).toBe(480);
		expect(parseGraphicGeometryValue(25, 1920, 'percent', true)).toBe(480);
		expect(parseGraphicGeometryValue(-8, 1920, 'grid', true)).toBe(480);

		// A size is not offset by the grid's centre, so the same 480px reads as 8.
		expect(parseGraphicGeometryValue(8, 1920, 'grid')).toBe(480);
		expect(displayGraphicGeometryValue(480, 1920, 'grid')).toBe(8);
		expect(displayGraphicGeometryValue(480, 1920, 'grid', true)).toBe(-8);
	});

	it('rounds an authored value to whole canonical pixels', () => {
		expect(parseGraphicGeometryValue(33.333, 1920, 'percent')).toBe(640);
		expect(parseGraphicGeometryValue(10.4, 1920, 'px')).toBe(10);
	});
});
