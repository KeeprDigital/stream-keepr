import type { GraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

enableAutoUnmount(afterEach);

function renderModel(overrides: Partial<Parameters<typeof resolveGraphicsCompositionRenderModel>[0]> = {}): GraphicsCompositionRenderModel {
	return resolveGraphicsCompositionRenderModel({
		output: 'overlay',
		canvasWidth: 1920,
		canvasHeight: 1080,
		graphics: [{
			id: 'lower-third',
			name: 'Lower third',
			items: [{
				type: 'shape',
				id: 'plate',
				label: 'Plate',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				geometry: {
					topLeft: { treatment: 'square', size: 0 },
					topRight: { treatment: 'square', size: 0 },
					bottomRight: { treatment: 'square', size: 0 },
					bottomLeft: { treatment: 'square', size: 0 },
					leftSlant: 0,
					rightSlant: 0,
				},
			}],
		}],
		visibleGraphicIds: ['lower-third'],
		...overrides,
	});
}

async function mountCanvas(slots: Record<string, string> = {}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Canvas.vue';
	const { default: Canvas } = await import(componentPath);

	return mount(Canvas, { props: { render: renderModel() }, slots });
}

describe('graphics compositor canvas backdrop', () => {
	it('paints host backdrop content behind every Broadcast Graphic', async () => {
		// The canvas paints the Screen Output's own backdrop — black for the Fill and
		// Key Outputs — so a host that draws behind the canvas element draws behind
		// that black. Inside it, first, is the only place a backdrop is visible in
		// every output and still beneath the composition.
		const wrapper = await mountCanvas({ backdrop: '<div data-testid="host-backdrop" />' });

		const backdrop = wrapper.get('[data-testid="host-backdrop"]').element;
		const graphic = wrapper.get('[data-broadcast-graphic="lower-third"]').element;

		expect(backdrop.compareDocumentPosition(graphic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(wrapper.get('.graphics-compositor-canvas').element.firstElementChild)
			.toBe(backdrop.parentElement);
	});

	it('draws nothing of its own when no host paints a backdrop', async () => {
		const wrapper = await mountCanvas();

		expect(wrapper.find('.graphics-compositor-canvas__backdrop').exists()).toBe(false);
	});
});
