import { mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { stubPointerCapture } from '~~/test/nuxt/helpers/pointerCapture';
import EditorPreview from '~/components/Graphics/EditorPreview.vue';
import { GRAPHICS_PREVIEW_READY_MESSAGE, GRAPHICS_PREVIEW_SELECT_MESSAGE } from '~/modules/graphics/previewMessages';

// The preview drawn at half the canvas, so a drag's pixels are canvas pixels doubled.
vi.mock('@vueuse/core', async importOriginal => ({
	...await importOriginal<typeof import('@vueuse/core')>(),
	useElementSize: () => ({
		width: ref(960),
		height: ref(540),
	}),
}));

beforeAll(stubPointerCapture);

const config = {
	type: 'host:config',
	config: { size: 1 },
};
const target = {
	type: 'host:target',
	target: { type: 'canvas' },
};

function mountPreview(props: Record<string, unknown> = {}) {
	return mount(EditorPreview, {
		attachTo: document.body,
		props: {
			eventId: 1,
			screenSlug: 'main',
			canvasWidth: 1920,
			canvasHeight: 1080,
			title: 'Editor preview',
			messages: [config, target],
			animationTarget: null,
			animationHint: 'Select something to preview its animation.',
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				ScreenSettingsSection: { template: '<section><slot name="actions" :open="true" /><slot /></section>' },
			},
		},
	});
}

type Wrapper = ReturnType<typeof mountPreview>;

/** The preview frame, with `contentWindow` replaced so a test can be or watch its sender. */
function previewFrame(wrapper: Wrapper, contentWindow: unknown) {
	const frame = wrapper.get('iframe').element;
	Object.defineProperty(frame, 'contentWindow', { configurable: true, value: contentWindow });
	return frame;
}

function message(origin: string, source: MessageEventSource | null, data: object) {
	window.dispatchEvent(new MessageEvent('message', { origin, source, data }));
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('graphics editor preview — what it tells its frame', () => {
	it('pushes every host message on load, then only the ones that change', async () => {
		const wrapper = mountPreview();
		const postMessage = vi.fn();
		previewFrame(wrapper, { postMessage });

		await wrapper.get('iframe').trigger('load');
		expect(postMessage.mock.calls.map(([sent]) => sent)).toEqual([config, target]);

		postMessage.mockClear();
		const moved = {
			type: 'host:target',
			target: { type: 'item', itemId: 'bar' },
		};
		await wrapper.setProps({
			messages: [config, moved],
		});
		expect(postMessage.mock.calls).toEqual([
			[moved, window.location.origin],
		]);
	});

	// The frame may mount its listeners after `load` fires, so it announces readiness (#235).
	it.each([
		[
			'its own frame',
			'own',
			window.location.origin,
			2,
		],
		[
			'a window it did not embed',
			'stranger',
			window.location.origin,
			0,
		],
		[
			'its frame from another origin',
			'own',
			'https://example.invalid',
			0,
		],
	] as const)('answers a ready announced by %s with %s… pushes', async (_, sender, origin, pushes) => {
		const wrapper = mountPreview();
		const postMessage = vi.fn();
		const frame = previewFrame(wrapper, { postMessage });
		const stranger = {
			postMessage: vi.fn(),
		} as unknown as MessageEventSource;

		message(origin, sender === 'own'
			? frame.contentWindow
			: stranger, { type: GRAPHICS_PREVIEW_READY_MESSAGE });
		await nextTick();

		expect(postMessage).toHaveBeenCalledTimes(pushes);
	});

	// Guides ride the preview's URL only, which is what keeps them off air.
	it.each([
		[
			'item guides, by default',
			undefined,
			{},
			['embed=preview', 'guides=1'],
			['safe=1', 'stress=1'],
		],
		[
			'safe areas once switched on',
			'preview-safe-area-guides',
			{},
			['safe=1'],
			[],
		],
		[
			'no item guides once switched off',
			'preview-item-guides',
			{},
			[],
			['guides=1'],
		],
		[
			'what its host adds',
			undefined,
			{
				urlOptions: { stressDataset: true },
			},
			['stress=1'],
			[],
		],
	] as const)('asks its frame for %s', async (_, toggle, props, present, absent) => {
		const wrapper = mountPreview(props);
		if (toggle)
			await wrapper.get(`[data-testid="${toggle}"]`).trigger('click');
		const src = wrapper.get('iframe').attributes('src')!;

		expect(src.startsWith('/event/1/screen/main?')).toBe(true);
		for (const token of present)
			expect(src).toContain(token);
		for (const token of absent)
			expect(src).not.toContain(token);
	});
});

describe('graphics editor preview — what its frame tells it', () => {
	const item = { type: 'item', graphicId: 'lower-third', itemId: 'bar' };

	it('accepts a selection only from its own same-origin frame, a ⌘-click as a toggle', async () => {
		const wrapper = mountPreview();
		previewFrame(wrapper, window);

		message(window.location.origin, window, { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: item });
		message(window.location.origin, window, { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: item, toggle: true });
		message('https://example.invalid', window, {
			type: GRAPHICS_PREVIEW_SELECT_MESSAGE,
			target: { type: 'canvas' },
		});
		message(window.location.origin, null, {
			type: GRAPHICS_PREVIEW_SELECT_MESSAGE,
			target: { type: 'canvas' },
		});
		await nextTick();

		expect(wrapper.emitted('select')).toEqual([
			[item, false],
			[item, true],
		]);
	});

	// A gone frame has a null `contentWindow`, which a bare `source === contentWindow` matches (#252).
	it('accepts no selection once there is no frame that could have sent one', async () => {
		const wrapper = mountPreview({
			receive: () => true,
		});
		previewFrame(wrapper, null);

		message(window.location.origin, null, { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: item });
		await nextTick();

		expect(wrapper.emitted('select')).toBeUndefined();
	});

	it('hands its host the reports it speaks for, from its own frame only', async () => {
		const received: unknown[] = [];
		const wrapper = mountPreview({
			receive: (arrival: MessageEvent, expected: { origin: string; source: unknown }) => {
				if (arrival.origin !== expected.origin || arrival.source !== expected.source)
					return false;
				received.push(arrival.data);
				return true;
			},
		});
		previewFrame(wrapper, window);

		message(window.location.origin, window, { type: 'host:select', target: 'frame' });
		await nextTick();

		expect(received).toEqual([
			{ type: 'host:select', target: 'frame' },
		]);
	});

	// A click in the frame focuses its document, whose key presses never reach the editor's shortcuts.
	it.each([
		[
			'a shared selection',
			{ type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: item },
		],
		[
			'a host\'s own report',
			{ type: 'host:select' },
		],
	])('hands keyboard focus back to the editor after %s', async (_, data) => {
		const wrapper = mountPreview({
			receive: (arrival: MessageEvent) => (arrival.data as { type: string }).type === 'host:select',
		});
		const frame = previewFrame(wrapper, window);
		frame.focus();
		expect(document.activeElement).toBe(frame);

		message(window.location.origin, window, data);
		await nextTick();

		expect(document.activeElement).not.toBe(frame);
	});
});

describe('graphics editor preview — canvas handles', () => {
	const selectionFrame = {
		rect: { x: 10, y: 20, width: 100, height: 40 },
		origin: { x: 0, y: 0 },
		snapLines: { x: [], y: [] },
	};

	it.each([
		['the selection it is given', selectionFrame, true],
		['no selection', null, false],
	] as const)('draws handles over its frame for %s', (_, frame, drawn) => {
		const wrapper = mountPreview({ selectionFrame: frame, selectionLabel: 'Bar' });

		expect(wrapper.find('[data-testid="canvas-manipulation-box"]').exists()).toBe(drawn);
		if (drawn)
			expect(wrapper.get('[data-testid="canvas-manipulation-box"]').attributes('aria-label')).toBe('Move Bar');
	});

	it('badges each selected locked layer on the canvas', () => {
		const wrapper = mountPreview({
			lockedBoxes: [
				{ x: 0, y: 0, width: 50, height: 50 },
			],
		});

		expect(wrapper.findAll('[data-testid="canvas-locked-layer"]')).toHaveLength(1);
	});

	it('hands its host a drag as one gesture of canvas rectangles', async () => {
		const wrapper = mountPreview({ selectionFrame });
		const box = wrapper.get('[data-testid="canvas-manipulation-box"]');

		await box.trigger('pointerdown', {
			button: 0,
			pointerId: 1,
			clientX: 0,
			clientY: 0,
		});
		await box.trigger('pointermove', { pointerId: 1, clientX: 30, clientY: 10 });
		await box.trigger('pointerup', { pointerId: 1, clientX: 30, clientY: 10 });

		expect(wrapper.emitted('gestureStart')).toHaveLength(1);
		expect(wrapper.emitted('manipulate')?.map(([rect]) => rect)).toEqual([
			{ x: 70, y: 40, width: 100, height: 40 },
		]);
		expect(wrapper.emitted('gestureEnd')).toHaveLength(1);
	});
});
