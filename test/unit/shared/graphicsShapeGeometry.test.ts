import type { ShapeGeometry } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	getShapeGeometryPreset,
	isRectangularShapeGeometry,
	SHAPE_GEOMETRY_PRESET_IDS,
	shapeGeometryPath,
	shapeGeometrySummary,
	shapeGeometryVertices,
	squareShapeGeometry,
} from '~~/shared/modules/graphics';

const SIZE = { width: 100, height: 50 };

function geometry(overrides: Partial<ShapeGeometry> = {}): ShapeGeometry {
	return { ...squareShapeGeometry(), ...overrides };
}

describe('shapeGeometry', () => {
	it('draws a plain rectangle as four lines', () => {
		expect(shapeGeometryPath(SIZE, geometry())).toBe('M 0 0 L 100 0 L 100 50 L 0 50 Z');
	});

	it('cuts one corner without touching the others', () => {
		const path = shapeGeometryPath(SIZE, geometry({ topRight: { treatment: 'cut', size: 20 } }));

		expect(path).toBe('M 0 0 L 80 0 L 100 20 L 100 50 L 0 50 Z');
	});

	it('rounds one corner with an arc of its own radius', () => {
		const path = shapeGeometryPath(SIZE, geometry({ topLeft: { treatment: 'rounded', size: 10 } }));

		expect(path).toBe('M 0 10 A 10 10 0 0 1 10 0 L 100 0 L 100 50 L 0 50 Z');
	});

	it('configures each corner independently', () => {
		const path = shapeGeometryPath(SIZE, geometry({
			topLeft: { treatment: 'rounded', size: 10 },
			topRight: { treatment: 'cut', size: 20 },
			bottomRight: { treatment: 'square', size: 40 },
			bottomLeft: { treatment: 'cut', size: 5 },
		}));

		// A square corner ignores its size, so the bottom-right stays a sharp vertex.
		expect(path).toBe('M 0 10 A 10 10 0 0 1 10 0 L 80 0 L 100 20 L 100 50 L 5 50 L 0 45 Z');
	});

	it('slants the right edge inwards from the top and the left edge from the bottom', () => {
		expect(shapeGeometryPath(SIZE, geometry({ rightSlant: 20 })))
			.toBe('M 0 0 L 80 0 L 100 50 L 0 50 Z');
		expect(shapeGeometryPath(SIZE, geometry({ leftSlant: -20 })))
			.toBe('M 0 0 L 100 0 L 100 50 L 20 50 Z');
	});

	it('bounds a corner treatment to half of each edge it consumes', () => {
		// A 40-tall shape cannot give a corner more than 20 along its short edge,
		// so two neighbouring treatments can never overrun each other.
		const path = shapeGeometryPath({ width: 100, height: 40 }, geometry({
			topLeft: { treatment: 'cut', size: 9999 },
			bottomLeft: { treatment: 'cut', size: 9999 },
		}));

		expect(path).toBe('M 0 20 L 20 0 L 100 0 L 100 40 L 20 40 Z');
	});

	it('bounds a pair of inward slants so the edges never cross', () => {
		const vertices = shapeGeometryVertices(SIZE, geometry({ leftSlant: 90, rightSlant: 90 }));

		expect(vertices[0]?.x).toBe(50);
		expect(vertices[1]?.x).toBe(50);
	});

	it('recognises an unmodified rectangle, so nothing is clipped for no reason', () => {
		expect(isRectangularShapeGeometry(geometry())).toBe(true);
		expect(isRectangularShapeGeometry(geometry({ topLeft: { treatment: 'rounded', size: 0 } }))).toBe(true);
		expect(isRectangularShapeGeometry(geometry({ topLeft: { treatment: 'rounded', size: 4 } }))).toBe(false);
		expect(isRectangularShapeGeometry(geometry({ rightSlant: 4 }))).toBe(false);
	});

	it('summarises a geometry for the authoring tree', () => {
		expect(shapeGeometrySummary(geometry())).toBe('rectangle');
		expect(shapeGeometrySummary(geometry({
			topLeft: { treatment: 'rounded', size: 4 },
			leftSlant: 10,
		}))).toBe('rounded • slanted');
	});

	it('initialises the same Shape Geometry from every preset', () => {
		for (const id of SHAPE_GEOMETRY_PRESET_IDS) {
			const result = getShapeGeometryPreset(id).apply(SIZE);

			// Each preset writes one Shape Geometry rather than a distinct shape type.
			expect(Object.keys(result.geometry).sort()).toEqual(
				Object.keys(squareShapeGeometry()).sort(),
			);
			expect(shapeGeometryPath(SIZE, result.geometry).startsWith('M ')).toBe(true);
		}
	});

	it('initialises a rule as a thin rectangle and a corner cut as cut corners', () => {
		expect(getShapeGeometryPreset('rule').apply(SIZE)).toMatchObject({
			height: 4,
			geometry: { leftSlant: 0, rightSlant: 0 },
		});
		expect(getShapeGeometryPreset('corner-cut').apply(SIZE).geometry).toMatchObject({
			topRight: { treatment: 'cut', size: 15 },
			bottomLeft: { treatment: 'cut', size: 15 },
			topLeft: { treatment: 'square' },
		});
		expect(getShapeGeometryPreset('slanted-edge').apply(SIZE).geometry.rightSlant).toBe(30);
	});
});
