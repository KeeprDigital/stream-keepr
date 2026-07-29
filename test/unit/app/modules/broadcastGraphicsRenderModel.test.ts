import { describe, expect, it } from 'vitest';
import { resolveBroadcastGraphicsRenderModel } from '~~/app/modules/broadcast-graphics/renderModel';

describe('broadcast Graphics render model', () => {
	it('renders an empty Broadcast Graphics Screen transparent in the Overlay Output', () => {
		const model = resolveBroadcastGraphicsRenderModel({ output: 'overlay' });

		expect(model.output).toBe('overlay');
		expect(model.canvasStyle.background).toBe('transparent');
	});

	it('renders an empty Broadcast Graphics Screen black in the Fill and Key Outputs', () => {
		expect(resolveBroadcastGraphicsRenderModel({ output: 'fill' }).canvasStyle.background).toBe('#000');
		expect(resolveBroadcastGraphicsRenderModel({ output: 'key' }).canvasStyle.background).toBe('#000');
	});

	it('gives the Overlay, Fill, and Key Outputs identical canvas dimensions', () => {
		const overlay = resolveBroadcastGraphicsRenderModel({ output: 'overlay' }).canvasStyle;
		const fill = resolveBroadcastGraphicsRenderModel({ output: 'fill' }).canvasStyle;
		const key = resolveBroadcastGraphicsRenderModel({ output: 'key' }).canvasStyle;

		expect([overlay.width, overlay.height]).toEqual(['100%', '100%']);
		expect([fill.width, fill.height]).toEqual([overlay.width, overlay.height]);
		expect([key.width, key.height]).toEqual([overlay.width, overlay.height]);
	});

	it('clips the canvas to its Screen so nothing renders outside the composed frame', () => {
		expect(resolveBroadcastGraphicsRenderModel({ output: 'overlay' }).canvasStyle).toMatchObject({
			position: 'relative',
			overflow: 'hidden',
		});
	});
});
