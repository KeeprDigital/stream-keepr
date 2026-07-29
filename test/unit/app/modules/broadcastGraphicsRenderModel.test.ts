import { describe, expect, it } from 'vitest';
import { resolveBroadcastGraphicsRenderModel } from '~~/app/modules/broadcast-graphics/renderModel';
import { DEFAULT_BROADCAST_GRAPHICS_CONFIG } from '~~/shared/types/screenConfig';

function config() {
	return structuredClone(DEFAULT_BROADCAST_GRAPHICS_CONFIG);
}

describe('broadcast Graphics render model', () => {
	it('renders an empty Broadcast Graphics Screen transparent in the Overlay Output', () => {
		const model = resolveBroadcastGraphicsRenderModel({ config: config(), output: 'overlay' });

		expect(model.output).toBe('overlay');
		expect(model.canvasStyle.background).toBe('transparent');
	});

	it('renders an empty Broadcast Graphics Screen black in the Fill and Key Outputs', () => {
		expect(resolveBroadcastGraphicsRenderModel({ config: config(), output: 'fill' }).canvasStyle.background).toBe('#000');
		expect(resolveBroadcastGraphicsRenderModel({ config: config(), output: 'key' }).canvasStyle.background).toBe('#000');
	});

	it('fills its Screen canvas so every Screen Output has identical dimensions', () => {
		for (const output of ['overlay', 'fill', 'key'] as const) {
			expect(resolveBroadcastGraphicsRenderModel({ config: config(), output }).canvasStyle).toMatchObject({
				width: '100%',
				height: '100%',
				position: 'relative',
				overflow: 'hidden',
			});
		}
	});
});
