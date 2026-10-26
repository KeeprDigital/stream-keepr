import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
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

beforeAll(() => {
	// happy-dom has no pointer capture; the overlay only asks for it.
	HTMLElement.prototype.setPointerCapture ??= () => {};
});

const RECT = {
	x: 100,
	y: 100,
	width: 200,
	height: 100,
};

function mountOverlay(props: Partial<{ rect: typeof RECT | null; origin: { x: number; y: number } }> = {}) {
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

async function drag(wrapper: Wrapper, selector: string, to: { x: number; y: number }, init: PointerEventInit = {}) {
	const target = wrapper.get(selector);
	await target.trigger('pointerdown', {
		button: 0,
		pointerId: 1,
		clientX: 0,
		clientY: 0,
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
