import type { Screen } from '~/types';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import {
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	GRAPHICS_PREVIEW_STATE_MESSAGE,
} from '~/modules/graphics/previewMessages';

enableAutoUnmount(afterEach);

const graphics = [{
	id: 'lower-third',
	name: 'Lower Third',
	items: [{
		type: 'shape' as const,
		id: 'bar',
		label: 'Shape 1',
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 100,
		height: 40,
		geometry: { cornerRadius: 0 },
		surfaceStyle: { fill: '#0077a3', fillOpacity: 1 },
	}],
}];

const ScreenSettingsCardStub = defineComponent({
	template: '<section><slot name="actions" :open="true" /><slot /></section>',
});

const SlotOnlyStub = defineComponent({ template: '<div><slot /></div>' });

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Preview.vue';
	const { default: Preview } = await import(componentPath);

	return mount(Preview, {
		props: {
			eventId: 1,
			screen: { id: 1, slug: 'main', screenConfig: { width: 1920, height: 1080 } } as Screen,
			graphics,
			previewGraphicId: 'lower-third',
			selectedTarget: { type: 'canvas' },
			canvasWidth: 1920,
			canvasHeight: 1080,
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UFormField: SlotOnlyStub,
				USwitch: USwitchStub,
				UFieldGroup: SlotOnlyStub,
				UButton: UButtonStub,
			},
		},
	});
}

describe('graphicsCompositorPreview', () => {
	it('embeds a Screen Output frame that asks for item guides but not safe areas by default', async () => {
		const wrapper = await mountComponent();
		const src = wrapper.get('iframe').attributes('src') ?? '';

		expect(src).toContain('output=overlay');
		expect(src).toContain('preview=1');
		expect(src).toContain('guides=1');
		expect(src).not.toContain('safe=1');
	});

	it('asks the preview frame for advisory safe-area guides only when the author turns them on', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="compositor-safe-area-guides"]').trigger('click');
		await nextTick();

		expect(wrapper.get('iframe').attributes('src')).toContain('safe=1');
	});

	it('stops asking for item guides when the author turns them off', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="compositor-item-guides"]').trigger('click');
		await nextTick();

		expect(wrapper.get('iframe').attributes('src')).not.toContain('guides=1');
	});

	it('selects the Fill and Key Screen Outputs from the same stable Screen URL', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[aria-label="Fill preview output"]').trigger('click');
		await nextTick();
		expect(wrapper.get('iframe').attributes('src')).toContain('output=fill');

		await wrapper.get('[aria-label="Key preview output"]').trigger('click');
		await nextTick();
		expect(wrapper.get('iframe').attributes('src')).toContain('output=key');
	});

	it('zooms the preview to the canvas at a fixed scale', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[aria-label="100% preview zoom"]').trigger('click');
		await nextTick();

		const style = wrapper.get('iframe').element.parentElement?.getAttribute('style') ?? '';
		expect(style).toContain('width: 1920px');
		expect(style).toContain('height: 1080px');
	});

	it('pushes the working composition into its own preview frame', async () => {
		const wrapper = await mountComponent();
		const frame = wrapper.get('iframe').element;
		const posted: unknown[] = [];
		Object.defineProperty(frame, 'contentWindow', {
			configurable: true,
			value: { postMessage: (message: unknown) => posted.push(message) },
		});

		await wrapper.get('iframe').trigger('load');

		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({
			type: GRAPHICS_PREVIEW_STATE_MESSAGE,
			state: { previewGraphicId: 'lower-third', selectedTarget: { type: 'canvas' } },
		});
	});

	it('accepts a canvas selection only from its own preview frame', async () => {
		const wrapper = await mountComponent();
		const frame = wrapper.get('iframe').element;
		Object.defineProperty(frame, 'contentWindow', { configurable: true, value: window });
		const target = { type: 'item', graphicId: 'lower-third', itemId: 'bar' };

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: window,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')?.[0]?.[0]).toEqual(target);

		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://elsewhere.test',
			source: window,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: { type: 'canvas' } },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')).toHaveLength(1);
	});
});
