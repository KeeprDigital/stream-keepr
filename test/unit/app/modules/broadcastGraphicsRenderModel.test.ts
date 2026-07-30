import type { BroadcastGraphicsRenderModelInput } from '~~/app/modules/broadcast-graphics/renderModel';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { resolveBroadcastGraphicsRenderModel } from '~~/app/modules/broadcast-graphics/renderModel';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

function graphic(id: string): BroadcastGraphicConfig {
	return {
		id,
		name: id,
		items: [{
			type: 'shape',
			id: `${id}-shape`,
			label: 'Shape 1',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			geometry: squareShapeGeometry(),
			surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
		}],
	};
}

function input(overrides: Partial<BroadcastGraphicsRenderModelInput> = {}): BroadcastGraphicsRenderModelInput {
	return {
		output: 'overlay',
		canvasWidth: 1920,
		canvasHeight: 1080,
		graphics: [],
		...overrides,
	};
}

describe('broadcast Graphics render model', () => {
	it('renders an empty Broadcast Graphics Screen transparent in the Overlay Output', () => {
		const model = resolveBroadcastGraphicsRenderModel(input());

		expect(model.output).toBe('overlay');
		expect(model.canvasStyle.background).toBe('transparent');
	});

	it('renders an empty Broadcast Graphics Screen black in the Fill and Key Outputs', () => {
		expect(resolveBroadcastGraphicsRenderModel(input({ output: 'fill' })).canvasStyle.background).toBe('#000000');
		expect(resolveBroadcastGraphicsRenderModel(input({ output: 'key' })).canvasStyle.background).toBe('#000000');
	});

	it('gives the Overlay, Fill, and Key Outputs identical canvas dimensions', () => {
		const overlay = resolveBroadcastGraphicsRenderModel(input()).canvasStyle;
		const fill = resolveBroadcastGraphicsRenderModel(input({ output: 'fill' })).canvasStyle;
		const key = resolveBroadcastGraphicsRenderModel(input({ output: 'key' })).canvasStyle;

		expect([overlay.width, overlay.height]).toEqual(['100%', '100%']);
		expect([fill.width, fill.height]).toEqual([overlay.width, overlay.height]);
		expect([key.width, key.height]).toEqual([overlay.width, overlay.height]);
	});

	it('clips the canvas to its Screen so nothing renders outside the composed frame', () => {
		expect(resolveBroadcastGraphicsRenderModel(input()).canvasStyle).toMatchObject({
			position: 'relative',
			overflow: 'hidden',
		});
	});

	it('renders an authored but off-air Broadcast Graphic on no Screen Output', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({ graphics: [graphic('lower-third')] }));

		expect(model.graphics).toEqual([]);
	});

	it('composes only the on-air Broadcast Graphics, in authored Screen stack order', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [graphic('back'), graphic('middle'), graphic('front')],
			onAirGraphicIds: ['front', 'back'],
		}));

		expect(model.graphics.map(entry => entry.id)).toEqual(['back', 'front']);
	});

	it('keeps advisory guides out of a Screen Output that does not ask for them', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [graphic('lower-third')],
			onAirGraphicIds: ['lower-third'],
		}));

		expect(model.safeAreaGuides).toEqual([]);
		expect(model.itemGuides).toEqual([]);
	});
});
