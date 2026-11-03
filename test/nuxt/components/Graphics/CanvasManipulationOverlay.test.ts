import type { GraphicAnchorPoint } from '~~/shared/types/graphics';
import type { SnapLines } from '~/modules/graphics/canvasManipulation';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { stubPointerCapture } from '~~/test/nuxt/helpers/pointerCapture';
import CanvasManipulationOverlay from '~/components/Graphics/CanvasManipulationOverlay.vue';

// The move and resize handles drawn over an editor preview: pointer movement on the drawn preview,
// turned into canvas pixels and handed to the host.

vi.mock('@vueuse/core', async importOriginal => ({
	...await importOriginal<typeof import('@vueuse/core')>(),
	useElementSize: () => ({
		width: ref(960),
		height: ref(540),
	}),
}));

enableAutoUnmount(afterEach);

beforeAll(stubPointerCapture);

const RECT = {
	x: 100,
	y: 100,
	width: 200,
	height: 100,
};

function mountOverlay(props: Partial<{
	rect: typeof RECT | null;
	origin: { x: number; y: number };
	snapLines: SnapLines;
	rotation: number;
	anchor: GraphicAnchorPoint;
}> = {}) {
	return mount(CanvasManipulationOverlay, {
		props: {
			rect: RECT,
			canvasWidth: 1920,
			canvasHeight: 1080,
			label: 'Clock',
			...props,
		},
	});
}

type Wrapper = ReturnType<typeof mountOverlay>;

async function drag(wrapper: Wrapper, selector: string, to: { x: number; y: number }, init: PointerEventInit = {}, from = { x: 0, y: 0 }) {
	const target = wrapper.get(selector);
	await target.trigger('pointerdown', {
		button: 0,
		pointerId: 1,
		clientX: from.x,
		clientY: from.y,
		...init,
	});
	await target.trigger('pointermove', {
		pointerId: 1,
		clientX: to.x,
		clientY: to.y,
		...init,
	});
	await target.trigger('pointerup', { pointerId: 1, clientX: to.x, clientY: to.y });
}

function changes(wrapper: Wrapper) {
	return wrapper.emitted('change')?.map(([rect]) => rect) ?? [];
}

describe('graphicsCanvasManipulationOverlay', () => {
	it('draws the selection box at the preview\'s scale', () => {
		const wrapper = mountOverlay();

		expect(wrapper.get('[data-testid="canvas-manipulation-box"]').attributes('style'))
			.toContain('left: 50px; top: 50px; width: 100px; height: 50px;');
	});

	it('draws nothing without a selection the canvas can move', () => {
		const wrapper = mountOverlay({ rect: null });

		expect(wrapper.find('[data-testid="canvas-manipulation-box"]').exists()).toBe(false);
	});

	it('moves the selection by the drag, in canvas pixels', async () => {
		const wrapper = mountOverlay();

		await drag(wrapper, '[data-testid="canvas-manipulation-box"]', { x: 30, y: 10 });

		expect(changes(wrapper)).toEqual([
			{
				x: 160,
				y: 120,
				width: 200,
				height: 100,
			},
		]);
	});

	it('resizes from a handle, keeping the opposite corner where it was', async () => {
		const wrapper = mountOverlay();

		await drag(wrapper, '[data-handle="se"]', { x: 20, y: 10 });

		expect(changes(wrapper)).toEqual([
			{
				x: 100,
				y: 100,
				width: 240,
				height: 120,
			},
		]);
	});

	it('keeps the aspect ratio while Shift is held', async () => {
		const wrapper = mountOverlay();

		await drag(wrapper, '[data-handle="se"]', { x: 100, y: 0 }, { shiftKey: true });

		expect(changes(wrapper).at(-1)).toEqual({
			x: 100,
			y: 100,
			width: 400,
			height: 200,
		});
	});

	it('snaps to a canvas edge, and lets Alt turn snapping off', async () => {
		const snapped = mountOverlay();
		await drag(snapped, '[data-testid="canvas-manipulation-box"]', { x: -48, y: 0 });
		expect(changes(snapped).at(-1)).toMatchObject({ x: 0 });

		const free = mountOverlay();
		await drag(free, '[data-testid="canvas-manipulation-box"]', { x: -48, y: 0 }, { altKey: true });
		expect(changes(free).at(-1)).toMatchObject({ x: 4 });
	});

	it('snaps to the lines it is given in its container\'s pixels, drawing the guide and the gap to the nearest neighbour while dragging', async () => {
		const wrapper = mountOverlay({
			origin: { x: 100, y: 0 },
			snapLines: {
				x: [0, 500],
				y: [0],
				neighbours: [
					{
						x: 600,
						y: 100,
						width: 50,
						height: 100,
					},
				],
			},
		});
		const box = wrapper.get('[data-testid="canvas-manipulation-box"]');

		await box.trigger('pointerdown', {
			button: 0,
			pointerId: 1,
			clientX: 0,
			clientY: 0,
		});
		await box.trigger('pointermove', { pointerId: 1, clientX: 98, clientY: 0 });

		expect(changes(wrapper).at(-1)).toMatchObject({ x: 300 });
		expect(wrapper.get('[data-testid="canvas-manipulation-guide"][data-axis="x"]').attributes('style')).toContain('left: 300px');
		const gap = wrapper.get('[data-testid="canvas-manipulation-gap"][data-axis="x"]');
		expect(gap.text()).toBe('100');
		expect(gap.attributes('style')).toContain('left: 300px; top: 75px; width: 50px;');

		await box.trigger('pointerup', { pointerId: 1 });
		expect(wrapper.find('[data-testid="canvas-manipulation-guide"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="canvas-manipulation-gap"]').exists()).toBe(false);
	});

	it('reports a rectangle in its container\'s pixels when the container is offset', async () => {
		const wrapper = mountOverlay({
			origin: { x: 400, y: 200 },
		});

		expect(wrapper.get('[data-testid="canvas-manipulation-box"]').attributes('style')).toContain('left: 250px; top: 150px;');

		await drag(wrapper, '[data-testid="canvas-manipulation-box"]', { x: 5, y: 5 });

		expect(changes(wrapper)).toEqual([
			{
				x: 110,
				y: 110,
				width: 200,
				height: 100,
			},
		]);
	});

	it('draws a rotated selection turned about its Graphic Anchor Point, with a rotate handle', () => {
		const wrapper = mountOverlay({ rotation: 30, anchor: 'center' });

		const style = wrapper.get('[data-testid="canvas-manipulation-box"]').attributes('style');
		expect(style).toContain('transform: rotate(30deg)');
		expect(style).toContain('transform-origin: 50% 50%');
		expect(wrapper.get('[data-handle="rotate"]').attributes('aria-label')).toBe('Rotate Clock');
	});

	it('offers no rotate handle for a layer that cannot turn', () => {
		const wrapper = mountOverlay();

		expect(wrapper.find('[data-handle="rotate"]').exists()).toBe(false);
	});

	// The handle stands 48 canvas pixels off the box at this scale, and must stay on the canvas to be reached.
	it.each([
		{ name: 'above the box', rect: RECT, placement: 'above' },
		{
			name: 'below a box at the top of the canvas',
			rect: { ...RECT, y: 0 },
			placement: 'below',
		},
		{
			name: 'inside a box filling the canvas',
			rect: {
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
			},
			placement: 'inside',
		},
	])('places the rotate handle $name', ({ rect, placement }) => {
		const wrapper = mountOverlay({ rect, rotation: 0, anchor: 'center' });

		expect(wrapper.get('[data-handle="rotate"]').attributes('data-placement')).toBe(placement);
	});

	it.each([
		{ rotation: 0, cursor: 'cursor-ew-resize' },
		{ rotation: 45, cursor: 'cursor-nwse-resize' },
		{ rotation: 90, cursor: 'cursor-ns-resize' },
	])('turns the east handle\'s resize cursor with a $rotation° rotation', ({ rotation, cursor }) => {
		const wrapper = mountOverlay({ rotation, anchor: 'center' });

		expect(wrapper.get('[data-handle="e"]').classes()).toContain(cursor);
	});

	// The anchor of the centred RECT is drawn at (100, 75); the drags sweep about it.
	it.each([
		{
			name: 'by the angle swept about its anchor',
			to: { x: 100, y: 125 },
			shiftKey: false,
			rotation: 90,
		},
		{
			name: 'freely without Shift',
			to: { x: 146.985, y: 92.1 },
			shiftKey: false,
			rotation: 20,
		},
		{
			name: 'in 15 degree steps while Shift is held',
			to: { x: 146.985, y: 92.1 },
			shiftKey: true,
			rotation: 15,
		},
	])('rotates the selection $name', async ({ to, shiftKey, rotation }) => {
		const wrapper = mountOverlay({ rotation: 0, anchor: 'center' });

		await drag(wrapper, '[data-handle="rotate"]', to, { shiftKey }, { x: 150, y: 75 });

		expect(wrapper.emitted('rotate')?.map(([degrees]) => degrees).at(-1)).toBe(rotation);
		expect(wrapper.emitted('change')).toBeUndefined();
	});

	it('resizes a rotated selection along its own axes, keeping the opposite handle where it is drawn', async () => {
		const wrapper = mountOverlay({ rotation: 90, anchor: 'center' });

		await drag(wrapper, '[data-handle="e"]', { x: 0, y: 25 });

		expect(changes(wrapper)).toEqual([
			{
				x: 75,
				y: 125,
				width: 250,
				height: 100,
			},
		]);
	});

	it('tags every frame of one drag with the same gesture, and the next drag with a new one', async () => {
		const wrapper = mountOverlay();
		const box = '[data-testid="canvas-manipulation-box"]';

		await wrapper.get(box).trigger('pointerdown', {
			button: 0,
			pointerId: 1,
			clientX: 0,
			clientY: 0,
		});
		await wrapper.get(box).trigger('pointermove', { pointerId: 1, clientX: 10, clientY: 0 });
		await wrapper.get(box).trigger('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
		await wrapper.get(box).trigger('pointerup', { pointerId: 1 });
		await drag(wrapper, box, { x: 10, y: 0 });

		const gestures = wrapper.emitted('change')!.map(([, gesture]) => gesture);
		expect(gestures[0]).toBe(gestures[1]);
		expect(gestures[2]).not.toBe(gestures[0]);
	});
});
