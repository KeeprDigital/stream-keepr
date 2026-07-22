import { describe, expect, it } from 'vitest';
import { anchorFeatureMatchOverlayRect, displayGeometryValue, featureMatchOverlayAlignmentCoordinate, featureMatchOverlayBorderRadiusCss, featureMatchOverlaySourceCutoutRect, parseGeometryInput, percentToPixels, pixelsToPercent, resizeFeatureMatchOverlayRectFromAnchor, roundedRectPath, updateFeatureMatchOverlayRectFromAnchor } from '~/utils/featureMatchOverlayGeometry';

describe('broadcast layout geometry utilities', () => {
	it('converts pixels to percentages of the canvas', () => {
		expect(pixelsToPercent(960, 1920)).toBe(50);
		expect(pixelsToPercent(333, 1920)).toBe(17.3438);
	});

	it('converts percentages back to rounded pixels', () => {
		expect(percentToPixels(50, 1920)).toBe(960);
		expect(percentToPixels(17.34375, 1920)).toBe(333);
	});

	it('displays values in the requested unit', () => {
		expect(displayGeometryValue(540, 1080, 'px')).toBe('540');
		expect(displayGeometryValue(540, 1080, '%')).toBe('50');
	});

	it('parses percent edits into stored pixels', () => {
		expect(parseGeometryInput('25', 1920, '%')).toBe(480);
		expect(parseGeometryInput('480', 1920, 'px')).toBe(480);
	});

	it('displays coordinates relative to the selected anchor without changing stored geometry', () => {
		const rect = { x: 100, y: 50, width: 320, height: 180 };

		expect(anchorFeatureMatchOverlayRect(rect, 'top-left')).toEqual(rect);
		expect(anchorFeatureMatchOverlayRect(rect, 'center')).toEqual({
			x: 260,
			y: 140,
			width: 320,
			height: 180,
		});
		expect(anchorFeatureMatchOverlayRect(rect, 'bottom-right')).toEqual({
			x: 420,
			y: 230,
			width: 320,
			height: 180,
		});
		expect(rect).toEqual({ x: 100, y: 50, width: 320, height: 180 });
	});

	it('converts edited anchor coordinates back to stored top-left geometry', () => {
		const rect = { x: 100, y: 50, width: 320, height: 180 };

		expect(updateFeatureMatchOverlayRectFromAnchor(rect, 'x', 500, 'center')).toEqual({ x: 340 });
		expect(updateFeatureMatchOverlayRectFromAnchor(rect, 'y', 250, 'bottom')).toEqual({ y: 70 });
	});

	it('keeps the selected anchor fixed while resizing', () => {
		const rect = { x: 100, y: 50, width: 320, height: 180 };

		expect(resizeFeatureMatchOverlayRectFromAnchor(rect, 400, 200, 'top-left')).toEqual({
			x: 100,
			y: 50,
			width: 400,
			height: 200,
		});
		expect(resizeFeatureMatchOverlayRectFromAnchor(rect, 400, 200, 'center')).toEqual({
			x: 60,
			y: 40,
			width: 400,
			height: 200,
		});
		expect(resizeFeatureMatchOverlayRectFromAnchor(rect, 400, 200, 'bottom-right')).toEqual({
			x: 20,
			y: 30,
			width: 400,
			height: 200,
		});
	});

	it('applies width and height edits through the same anchored resize path', () => {
		const rect = { x: 100, y: 50, width: 321, height: 181 };

		expect(updateFeatureMatchOverlayRectFromAnchor(rect, 'width', 400.4, 'right')).toEqual({
			x: 21,
			y: 50,
			width: 400,
			height: 181,
		});
		expect(updateFeatureMatchOverlayRectFromAnchor(rect, 'height', 200.4, 'bottom')).toEqual({
			x: 100,
			y: 31,
			width: 321,
			height: 200,
		});
	});

	it('uses configured border radii as CSS outer radii', () => {
		expect(featureMatchOverlayBorderRadiusCss({ borderRadius: 12 })).toBe('12px 12px 12px 12px');
		expect(featureMatchOverlayBorderRadiusCss({
			borderRadius: 12,
			borderRadiusTopRight: 4,
			borderRadiusBottomLeft: 2,
		})).toBe('12px 4px 12px 2px');
	});

	it('insets cutout geometry to the inner edge of a visible source border', () => {
		const cutout = featureMatchOverlaySourceCutoutRect({
			id: 'main-source',
			type: 'source',
			label: 'Main',
			visible: true,
			frameCutout: true,
			x: 100,
			y: 50,
			width: 320,
			height: 180,
			surfaceStyle: {
				backgroundColor: '#000000',
				backgroundOpacity: 0,
				borderVisible: true,
				borderColor: '#ffffff',
				borderWidth: 6,
				borderRadius: 18,
			},
		});

		expect(cutout).toEqual({
			x: 106,
			y: 56,
			width: 308,
			height: 168,
			radii: {
				topLeft: 12,
				topRight: 12,
				bottomRight: 12,
				bottomLeft: 12,
			},
		});
	});

	it('does not reserve cutout space for hidden source border sides', () => {
		const cutout = featureMatchOverlaySourceCutoutRect({
			id: 'side-source',
			type: 'source',
			label: 'Side',
			visible: true,
			frameCutout: true,
			x: 100,
			y: 50,
			width: 320,
			height: 180,
			surfaceStyle: {
				backgroundColor: '#000000',
				backgroundOpacity: 0,
				borderVisible: true,
				borderColor: '#ffffff',
				borderWidth: 6,
				borderRadius: 18,
				borderLeftVisible: false,
				borderBottomVisible: false,
			},
		});

		expect(cutout).toEqual({
			x: 100,
			y: 56,
			width: 314,
			height: 174,
			radii: {
				topLeft: 12,
				topRight: 12,
				bottomRight: 12,
				bottomLeft: 18,
			},
		});
	});

	it('cuts the full source rect when the source border is hidden', () => {
		const cutout = featureMatchOverlaySourceCutoutRect({
			id: 'player1-source',
			type: 'source',
			label: 'Player',
			visible: true,
			frameCutout: true,
			x: 10,
			y: 20,
			width: 100,
			height: 80,
			surfaceStyle: {
				backgroundColor: '#000000',
				backgroundOpacity: 0,
				borderVisible: false,
				borderColor: '#ffffff',
				borderWidth: 10,
				borderRadius: 14,
			},
		});

		expect(cutout.x).toBe(10);
		expect(cutout.y).toBe(20);
		expect(cutout.width).toBe(100);
		expect(cutout.height).toBe(80);
		expect(cutout.radii.topLeft).toBe(14);
	});

	it('renders rounded cutouts as paths so mask and CSS radii share the same geometry', () => {
		expect(roundedRectPath({
			x: 10,
			y: 20,
			width: 100,
			height: 50,
			radii: { topLeft: 8, topRight: 6, bottomRight: 4, bottomLeft: 2 },
		})).toBe('M 18 20 H 104 A 6 6 0 0 1 110 26 V 66 A 4 4 0 0 1 106 70 H 12 A 2 2 0 0 1 10 68 V 28 A 8 8 0 0 1 18 20 Z');
	});
	it('resolves hard-edge and center alignment coordinates', () => {
		expect(featureMatchOverlayAlignmentCoordinate('left', 1920)).toBe(0);
		expect(featureMatchOverlayAlignmentCoordinate('center', 1920)).toBe(960);
		expect(featureMatchOverlayAlignmentCoordinate('right', 1920)).toBe(1920);
		expect(featureMatchOverlayAlignmentCoordinate('top', 1080)).toBe(0);
		expect(featureMatchOverlayAlignmentCoordinate('bottom', 1080)).toBe(1080);
		// Rounded to the geometry precision used everywhere else.
		expect(featureMatchOverlayAlignmentCoordinate('center', 1085)).toBe(542.5);
	});
});
