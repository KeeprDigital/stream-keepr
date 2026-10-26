import { describe, expect, it } from 'vitest';
import { graphicStyleSetEntrySchema } from '~~/server/schemas/api/graphicStyleSet';
import { broadcastGraphicsModeConfigSchema } from '~~/server/schemas/api/screen';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

/**
 * One stop bound for every Graphic Fill: a Graphic Item's own and a Graphic Style
 * Set fill entry both hold two to four gradient stops. The one fill fields control
 * offers add and remove within those bounds for both, so a fill the editor builds
 * is one either write accepts.
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

function entryAccepts(count: number) {
	return graphicStyleSetEntrySchema.safeParse({
		id: 'accent-fill',
		kind: 'fill',
		name: 'Accent fill',
		schemaVersion: 1,
		value: {
			type: 'linear-gradient',
			angle: 90,
			stops: stops(count, { colorEntryId: 'brand' }),
		},
	}).success;
}

describe('graphic fill stop bounds', () => {
	it.each([
		['a Graphic Item\'s fill', itemAccepts],
		['a Graphic Style Set fill entry', entryAccepts],
	])('holds %s to two to four stops', (_, accepts) => {
		expect([1, 2, 3, 4, 5].map(accepts)).toEqual([false, true, true, true, false]);
	});
});
