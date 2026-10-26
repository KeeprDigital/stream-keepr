import { describe, expect, it } from 'vitest';
import { featureMatchOverlayBorderRadiusCss, featureMatchOverlaySourceCutoutRect, roundedRectPath } from '~/utils/featureMatchOverlayGeometry';

describe('broadcast layout geometry utilities', () => {
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
			label: 'Main',
			visible: true,
			frameCutout: true,
			x: 100,
			y: 50,
			width: 320,
			height: 180,
			framingStyle: {
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
			label: 'Side',
			visible: true,
			frameCutout: true,
			x: 100,
			y: 50,
			width: 320,
			height: 180,
			framingStyle: {
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
			label: 'Player',
			visible: true,
			frameCutout: true,
			x: 10,
			y: 20,
			width: 100,
			height: 80,
			framingStyle: {
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
			radii: {
				topLeft: 8,
				topRight: 6,
				bottomRight: 4,
				bottomLeft: 2,
			},
		})).toBe('M 18 20 H 104 A 6 6 0 0 1 110 26 V 66 A 4 4 0 0 1 106 70 H 12 A 2 2 0 0 1 10 68 V 28 A 8 8 0 0 1 18 20 Z');
	});
});
