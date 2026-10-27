import { describe, expect, it } from 'vitest';
import { broadcastGraphicsModeConfigSchema } from '~~/server/schemas/api/screen';
import { parseThemeTokenWrite } from '~~/shared/themeTokens';

/**
 * One set of Shape Geometry bounds for a Shape Graphic Item and a Theme's Shape
 * Geometry token: corner sizes from 0 to 10000 and slants either way up to
 * 10000, every corner and both slants present.
 */

const GEOMETRY = {
	topLeft: { treatment: 'square', size: 0 },
	topRight: { treatment: 'rounded', size: 12 },
	bottomRight: { treatment: 'cut', size: 12 },
	bottomLeft: { treatment: 'square', size: 0 },
	leftSlant: 0,
	rightSlant: 0,
};

function withShape(geometry: Record<string, unknown>) {
	return broadcastGraphicsModeConfigSchema.safeParse({
		graphics: [
			{
				id: 'a',
				name: 'A',
				inputs: [],
				items: [
					{
						type: 'shape',
						id: 'shape',
						label: 'Shape 1',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 10,
						height: 10,
						geometry,
					},
				],
			},
		],
	}).success;
}

function withToken(geometry: Record<string, unknown>) {
	return parseThemeTokenWrite('panel-shape', geometry).ok;
}

describe.each([
	['a Shape Graphic Item', withShape],
	['a Theme Shape Geometry token', withToken],
])('shape geometry bounds for %s', (_owner, accepts) => {
	it('accepts a geometry at the bounds', () => {
		expect(accepts(GEOMETRY)).toBe(true);
		expect(accepts({
			...GEOMETRY,
			topLeft: { treatment: 'rounded', size: 10_000 },
			leftSlant: -10_000,
			rightSlant: 10_000,
		})).toBe(true);
	});

	it('refuses a corner size or slant past the bounds', () => {
		expect(accepts({
			...GEOMETRY,
			topLeft: { treatment: 'rounded', size: 10_001 },
		})).toBe(false);
		expect(accepts({
			...GEOMETRY,
			topLeft: { treatment: 'rounded', size: -1 },
		})).toBe(false);
		expect(accepts({ ...GEOMETRY, leftSlant: -10_001 })).toBe(false);
		expect(accepts({ ...GEOMETRY, rightSlant: 10_001 })).toBe(false);
	});

	it('refuses a geometry missing a corner or carrying an unknown key', () => {
		const { bottomLeft: _missing, ...withoutCorner } = GEOMETRY;
		expect(accepts(withoutCorner)).toBe(false);
		expect(accepts({ ...GEOMETRY, skew: 4 })).toBe(false);
		expect(accepts({
			...GEOMETRY,
			topLeft: { treatment: 'bevel', size: 4 },
		})).toBe(false);
	});
});
