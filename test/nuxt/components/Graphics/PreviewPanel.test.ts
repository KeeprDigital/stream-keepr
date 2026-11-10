import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import PreviewPanel from '~/components/Graphics/PreviewPanel.vue';

// The one preview panel shared by the Broadcast Graphics and Feature Match Overlay editors: output
// selection, zoom and pan, the canvas-aspect viewport, and the item and safe-area guide switches.

// The fitted preview is drawn 960 pixels wide: a 1920-wide canvas fits at 50%.
vi.mock('@vueuse/core', async importOriginal => ({
	...await importOriginal<typeof import('@vueuse/core')>(),
	useElementSize: () => ({
		width: ref(960),
		height: ref(540),
	}),
}));

enableAutoUnmount(afterEach);

const SlotOnlyStub = defineComponent({ template: '<div><slot /></div>' });

const ScreenSettingsCardStub = defineComponent({
	props: {
		collapsible: { type: Boolean, required: false },
	},
	template: '<section><slot name="actions" :open="true" /><slot /></section>',
});

const global = {
	stubs: {
		ScreenSettingsCard: ScreenSettingsCardStub,
		UFormField: SlotOnlyStub,
		UFieldGroup: SlotOnlyStub,
		USwitch: defineComponent({
			props: {
				modelValue: { type: Boolean, required: false },
			},
			emits: ['update:modelValue'],
			template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
		}),
		UButton: defineComponent({
			emits: ['click'],
			template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
		}),
	},
};

function mountPanel(props: Record<string, unknown> = {}) {
	return mount(PreviewPanel, {
		props: { canvasWidth: 1920, canvasHeight: 1080, ...props },
		slots: {
			controls: () => h('span', { 'data-testid': 'host-control' }),
			default: () => h('p', { 'data-testid': 'host-content' }),
			viewport: () => [
				h('iframe', { title: 'host frame', srcdoc: '<p>frame</p>' }),
				h('button', { 'type': 'button', 'data-testid': 'host-handle' }),
			],
		},
		global,
		attachTo: document.body,
	});
}

type Wrapper = ReturnType<typeof mountPanel>;

function viewport(wrapper: Wrapper) {
	return wrapper.get('[data-testid="preview-viewport"]').element;
}

function zoomLevel(wrapper: Wrapper) {
	return wrapper.get('[data-testid="preview-zoom-level"]').text();
}

function pressed(wrapper: Wrapper) {
	return wrapper.findAll('[aria-label$="preview zoom"]')
		.filter(button => button.attributes('aria-pressed') === 'true')
		.map(button => button.text());
}

function scroller(wrapper: Wrapper) {
	return wrapper.get('[data-testid="preview-scroller"]').element as HTMLElement;
}

async function key(type: 'keydown' | 'keyup', init: KeyboardEventInit, target: EventTarget = document.body) {
	const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(event);
	await nextTick();
	return event;
}

async function wheel(wrapper: Wrapper, init: WheelEventInit) {
	const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
	// happy-dom's WheelEvent is not a MouseEvent: it carries no modifiers or position.
	for (const field of [
		'ctrlKey',
		'metaKey',
		'clientX',
		'clientY',
	] as const) {
		Object.defineProperty(event, field, { value: init[field] ?? (field.endsWith('Key')
			? false
			: 0) });
	}
	viewport(wrapper).dispatchEvent(event);
	await nextTick();
	return event;
}

async function pointer(target: EventTarget, type: string, init: PointerEventInit) {
	target.dispatchEvent(new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		...init,
	}));
	await nextTick();
}

describe('graphicsPreviewPanel', () => {
	it('selects the Overlay, Fill or Key Screen Output', async () => {
		const wrapper = mountPanel({ output: 'overlay' });

		await wrapper.get('[aria-label="Key preview output"]').trigger('click');

		expect(wrapper.emitted('update:output')).toEqual([
			['key'],
		]);
	});

	it('turns item guides off and safe-area guides on', async () => {
		const wrapper = mountPanel({ itemGuides: true, safeAreaGuides: false });

		await wrapper.get('[data-testid="preview-item-guides"]').trigger('click');
		await wrapper.get('[data-testid="preview-safe-area-guides"]').trigger('click');

		expect(wrapper.emitted('update:itemGuides')).toEqual([
			[false],
		]);
		expect(wrapper.emitted('update:safeAreaGuides')).toEqual([
			[true],
		]);
	});

	it('fits the viewport to the canvas aspect ratio over a transparency backdrop', () => {
		const wrapper = mountPanel({ canvasWidth: 1080, canvasHeight: 1920 });
		const style = wrapper.get('[data-testid="preview-stage"]').attributes('style') ?? '';

		expect(style).toContain('aspect-ratio: 1080 / 1920');
		expect(viewport(wrapper).classList).toContain('transparent-checkerboard-backdrop');
	});

	it('starts every visit at Fit, showing the fitted percentage', () => {
		const wrapper = mountPanel();

		expect(pressed(wrapper)).toEqual(['Fit']);
		expect(zoomLevel(wrapper)).toBe('50%');
	});

	it.each([
		{
			button: '100%',
			width: '1920px',
			height: '1080px',
			level: '100%',
		},
		{
			button: '50%',
			width: '960px',
			height: '540px',
			level: '50%',
		},
	])('draws the canvas at $button', async ({ button, width, height, level }) => {
		const wrapper = mountPanel();

		await wrapper.get(`[aria-label="${button} preview zoom"]`).trigger('click');

		const style = viewport(wrapper).getAttribute('style') ?? '';
		expect(style).toContain(`width: ${width}`);
		expect(style).toContain(`height: ${height}`);
		expect(pressed(wrapper)).toEqual([button]);
		expect(zoomLevel(wrapper)).toBe(level);
	});

	it.each([
		{
			case: '⌘-wheel up zooms in',
			init: { metaKey: true, deltaY: -100 },
			zoomed: 1,
			taken: true,
		},
		{
			case: 'Ctrl-wheel down zooms out',
			init: { ctrlKey: true, deltaY: 100 },
			zoomed: -1,
			taken: true,
		},
		{
			case: 'a plain wheel scrolls rather than zooms',
			init: { deltaY: -100 },
			zoomed: 0,
			taken: false,
		},
	])('$case', async ({ init, zoomed, taken }) => {
		const wrapper = mountPanel();

		const event = await wheel(wrapper, init);

		expect(Math.sign(Number.parseInt(zoomLevel(wrapper)) - 50)).toBe(zoomed);
		expect(event.defaultPrevented).toBe(taken);
		expect(pressed(wrapper)).toEqual(taken
			? []
			: ['Fit']);
	});

	it('holds the zoom still while a press in the viewport drags, and zooms again once it ends', async () => {
		const wrapper = mountPanel();
		const handle = wrapper.get('[data-testid="host-handle"]').element;
		await pointer(scroller(wrapper), 'pointerenter', {});

		await pointer(handle, 'pointerdown', { button: 0 });
		const during = await wheel(wrapper, { metaKey: true, deltaY: -100 });
		await key('keydown', { key: '1', metaKey: true });
		await key('keydown', { key: ' ', code: 'Space' });
		expect(zoomLevel(wrapper)).toBe('50%');
		expect(during.defaultPrevented).toBe(true);
		expect(wrapper.find('[data-testid="preview-pan-surface"]').exists()).toBe(false);

		await pointer(window, 'pointerup', { button: 0 });
		await key('keydown', { key: '1', metaKey: true });
		expect(zoomLevel(wrapper)).toBe('100%');
	});

	it.each([
		{
			case: '⌘1 is 100% with the pointer in the preview',
			shortcut: { key: '1', metaKey: true },
			where: 'pointer',
			level: '100%',
		},
		{
			case: 'Ctrl-1 is 100% with focus in the preview',
			shortcut: { key: '1', ctrlKey: true },
			where: 'focus',
			level: '100%',
		},
		{
			case: '⌘1 is the browser\'s elsewhere',
			shortcut: { key: '1', metaKey: true },
			where: 'elsewhere',
			level: '50%',
		},
	])('$case', async ({ shortcut, where, level }) => {
		const wrapper = mountPanel();
		if (where === 'pointer')
			await pointer(scroller(wrapper), 'pointerenter', {});
		if (where === 'focus')
			(wrapper.get('[data-testid="host-handle"]').element as HTMLElement).focus();

		const event = await key('keydown', shortcut, document.activeElement ?? document.body);

		expect(zoomLevel(wrapper)).toBe(level);
		expect(event.defaultPrevented).toBe(where !== 'elsewhere');
	});

	it('hears ⌘1 pressed in the preview frame\'s own document, and again once it reloads', async () => {
		const wrapper = mountPanel();
		const frame = wrapper.get('iframe').element as HTMLIFrameElement;

		const first = await key('keydown', { key: '1', metaKey: true }, frame.contentWindow!);
		await wrapper.get('[aria-label="Fit preview zoom"]').trigger('click');
		const before = frame.contentWindow;
		frame.setAttribute('srcdoc', '<p>reloaded</p>');
		frame.dispatchEvent(new Event('load'));
		expect(frame.contentWindow).not.toBe(before);
		const reloaded = await key('keydown', { key: '1', metaKey: true }, frame.contentWindow!);

		expect(first.defaultPrevented).toBe(true);
		expect(reloaded.defaultPrevented).toBe(true);
		expect(zoomLevel(wrapper)).toBe('100%');
	});

	it('⌘0 fits again', async () => {
		const wrapper = mountPanel();
		await wrapper.get('[aria-label="100% preview zoom"]').trigger('click');
		await pointer(scroller(wrapper), 'pointerenter', {});

		await key('keydown', { key: '0', metaKey: true });

		expect(pressed(wrapper)).toEqual(['Fit']);
		expect(zoomLevel(wrapper)).toBe('50%');
	});

	it('pans while Space is held and the pointer drags', async () => {
		const wrapper = mountPanel();
		await wrapper.get('[aria-label="100% preview zoom"]').trigger('click');
		scroller(wrapper).scrollLeft = 300;
		scroller(wrapper).scrollTop = 200;
		await pointer(scroller(wrapper), 'pointerenter', {});

		const space = await key('keydown', { key: ' ', code: 'Space' });
		const surface = wrapper.get('[data-testid="preview-pan-surface"]').element;
		await pointer(surface, 'pointerdown', { button: 0, clientX: 500, clientY: 300 });
		await pointer(window, 'pointermove', { clientX: 400, clientY: 250 });
		await pointer(window, 'pointerup', { clientX: 400, clientY: 250 });
		await key('keyup', { key: ' ', code: 'Space' });

		expect(space.defaultPrevented).toBe(true);
		expect(scroller(wrapper).scrollLeft).toBe(400);
		expect(scroller(wrapper).scrollTop).toBe(250);
		expect(wrapper.find('[data-testid="preview-pan-surface"]').exists()).toBe(false);
	});

	it('pans on a middle-button drag', async () => {
		const wrapper = mountPanel();
		await wrapper.get('[aria-label="100% preview zoom"]').trigger('click');
		scroller(wrapper).scrollLeft = 300;

		await pointer(viewport(wrapper), 'pointerdown', { button: 1, clientX: 500, clientY: 300 });
		await pointer(window, 'pointermove', { clientX: 450, clientY: 300 });
		await pointer(window, 'pointerup', { clientX: 450, clientY: 300 });

		expect(scroller(wrapper).scrollLeft).toBe(350);
	});

	it('leaves Space to a field being typed in, even with the pointer over the preview', async () => {
		const wrapper = mountPanel();
		const field = document.createElement('input');
		document.body.appendChild(field);
		onTestFinished(() => {
			field.remove();
		});
		field.focus();
		await pointer(scroller(wrapper), 'pointerenter', {});

		const space = await key('keydown', { key: ' ', code: 'Space' }, field);

		expect(space.defaultPrevented).toBe(false);
		expect(wrapper.find('[data-testid="preview-pan-surface"]').exists()).toBe(false);
	});

	it('puts a solid background behind the viewport in place of the transparency backdrop', () => {
		const wrapper = mountPanel({ background: '#00b140' });

		expect(viewport(wrapper).classList).not.toContain('transparent-checkerboard-backdrop');
		expect(viewport(wrapper).getAttribute('style')).toContain('background-color: #00b140');
	});

	it('leaves room for the host\'s own controls, content and preview iframe', () => {
		const wrapper = mountPanel();

		expect(wrapper.find('[data-testid="host-control"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="host-content"]').exists()).toBe(true);
		expect(viewport(wrapper).querySelector('iframe')).not.toBeNull();
	});

	// The Graphic Animation Preview controls sit behind one toolbar control. They stay
	// mounted while hidden: they hold the run, so a loop outlives closing them.
	describe('animation controls', () => {
		const toggle = '[data-testid="preview-animation-toggle"]';

		function mountWithAnimation(props: Record<string, unknown> = {}) {
			return mount(PreviewPanel, {
				props: { canvasWidth: 1920, canvasHeight: 1080, ...props },
				slots: { animation: () => h('p', { 'data-testid': 'host-animation' }) },
				global,
				attachTo: document.body,
			});
		}

		it('keeps them hidden until the one control opens them, and hides them again', async () => {
			const wrapper = mountWithAnimation();
			const controls = wrapper.get('[data-testid="host-animation"]');

			expect(wrapper.get(toggle).attributes('aria-expanded')).toBe('false');
			expect(controls.isVisible()).toBe(false);

			await wrapper.get(toggle).trigger('click');
			expect(wrapper.get(toggle).attributes('aria-expanded')).toBe('true');
			expect(controls.isVisible()).toBe(true);
			expect(wrapper.get(`[id="${wrapper.get(toggle).attributes('aria-controls')}"]`).element.contains(controls.element)).toBe(true);

			await wrapper.get(toggle).trigger('click');
			expect(wrapper.get(toggle).attributes('aria-expanded')).toBe('false');
			expect(wrapper.get('[data-testid="host-animation"]').isVisible()).toBe(false);
		});

		it.each([
			{ animationPlaying: true, playing: 'true', label: 'Animation, playing' },
			{ animationPlaying: false, playing: 'false', label: 'Animation' },
		])('marks the closed control when a run is playing: $animationPlaying', ({ animationPlaying, playing, label }) => {
			const wrapper = mountWithAnimation({ animationPlaying });

			expect(wrapper.get(toggle).attributes('data-playing')).toBe(playing);
			expect(wrapper.get(toggle).attributes('aria-label')).toBe(label);
		});

		it('offers no control to a host with no animation controls', () => {
			expect(mountPanel().find(toggle).exists()).toBe(false);
		});
	});

	it('collapses by default, and stays open when the host says it cannot', () => {
		expect(mountPanel().findComponent(ScreenSettingsCardStub).props('collapsible')).toBe(true);
		expect(mountPanel({ collapsible: false }).findComponent(ScreenSettingsCardStub).props('collapsible')).toBe(false);
	});
});
