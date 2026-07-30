import { describe, expect, it } from 'vitest';
import { shapeGeometryBorderRadius, shapeGeometryClipPath } from '~~/app/utils/graphicShapeGeometry';

describe('graphic Shape Geometry CSS', () => {
	it('keeps rounded corners in border radius and cut/slanted edges in a bounded polygon', () => {
		const geometry = {
			topLeft: { kind: 'rounded' as const, size: 12 },
			topRight: { kind: 'cut' as const, size: 20 },
			bottomRight: { kind: 'square' as const },
			bottomLeft: { kind: 'cut' as const, size: 999 },
			leftEdgeSlant: 16,
			rightEdgeSlant: 24,
		};

		expect(shapeGeometryBorderRadius(geometry)).toBe('12px 0px 0px 0px');
		expect(shapeGeometryClipPath(geometry, 100, 60)).toBe(
			'polygon(16px 0px, 76px 0px, 100px 24px, 100px 60px, 100px 60px, 30px 60px, 0px 30px, 0px 16px)',
		);
	});

	it('does not emit a clip path for square geometry without slants', () => {
		const square = {
			topLeft: { kind: 'square' as const },
			topRight: { kind: 'square' as const },
			bottomRight: { kind: 'square' as const },
			bottomLeft: { kind: 'square' as const },
		};

		expect(shapeGeometryClipPath(square, 100, 60)).toBeUndefined();
	});
});
