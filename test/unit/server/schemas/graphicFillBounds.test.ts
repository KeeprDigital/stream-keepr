import { describe, expect, it } from 'vitest';
import { backgroundModeConfigSchema, broadcastGraphicsModeConfigSchema } from '~~/server/schemas/api/screen';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import { parseThemeTokenWrite } from '~~/shared/themeTokens';

/**
 * One stop bound for every Graphic Fill: a Graphic Item's own, a Theme's fill
 * token and a gradient Background Layer all hold two to four gradient stops. The
 * one fill fields control offers add and remove within those bounds for each, so
 * a fill the editor builds is one every write accepts.
 */

function stops(count: number, color: Record<string, string>) {
	return Array.from({ length: count }, (_, index) => ({
		...color,
		position: index / Math.max(1, count - 1),
		opacity: 1,
	}));
}

function itemAccepts(count: number) {
	return broadcastGraphicsModeConfigSchema.safeParse({
		graphics: [
			{
				id: 'a',
				name: 'A',
				items: [
					{
						type: 'shape',
						id: 'bed',
						label: 'Bed',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 100,
						height: 100,
						geometry: squareShapeGeometry(),
						surfaceStyle: {
							fill: {
								type: 'linear-gradient',
								angle: 90,
								stops: stops(count, { color: '#ffffff' }),
							},
							fillOpacity: 1,
						},
					},
				],
			},
		],
	}).success;
}

function tokenAccepts(count: number) {
	return parseThemeTokenWrite('accent-fill', {
		type: 'linear-gradient',
		angle: 90,
		stops: stops(count, { color: '#ffffff' }),
	}).ok;
}

function gradientLayers(gradient: unknown) {
	return [
		{
			id: 'grad',
			type: 'gradient',
			enabled: true,
			opacity: 1,
			gradient,
		},
	];
}

function gradientFill(count: number) {
	return {
		type: 'linear-gradient',
		angle: 180,
		stops: stops(count, { color: '#0f172a' }),
	};
}

function screenLayerAccepts(count: number) {
	return backgroundModeConfigSchema.safeParse({
		layers: gradientLayers(gradientFill(count)),
	}).success;
}

function themeLayerAccepts(count: number) {
	return parseThemeTokenWrite('background', gradientLayers(gradientFill(count))).ok;
}

describe('graphic fill stop bounds', () => {
	it.each([
		['a Graphic Item\'s fill', itemAccepts],
		['a Theme fill token', tokenAccepts],
		['a Screen\'s gradient Background Layer', screenLayerAccepts],
		['a Theme\'s gradient Background Layer', themeLayerAccepts],
	])('holds %s to two to four stops', (_, accepts) => {
		expect([1, 2, 3, 4, 5].map(accepts)).toEqual([false, true, true, true, false]);
	});
});

// A gradient Background Layer stored before it held a Graphic Fill is a CSS string, which a
// re-sent stack still carries; a solid fill is a colour layer's job.
describe('a gradient Background Layer', () => {
	it.each([
		['a stored CSS gradient string', 'linear-gradient(180deg, #000, #123)', true],
		['an empty string', '', false],
		[
			'a solid Graphic Fill',
			{ type: 'solid', color: '#0f172a' },
			false,
		],
	])('given %s', (_, gradient, accepted) => {
		expect(backgroundModeConfigSchema.safeParse({
			layers: gradientLayers(gradient),
		}).success).toBe(accepted);
		expect(parseThemeTokenWrite('background', gradientLayers(gradient)).ok).toBe(accepted);
	});
});
