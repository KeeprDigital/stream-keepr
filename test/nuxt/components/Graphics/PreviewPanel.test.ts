import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import PreviewPanel from '~/components/Graphics/PreviewPanel.vue';

/**
 * The one preview panel shared by the Broadcast Graphics and Feature Match
 * Overlay editors: output selection, zoom, the canvas-aspect viewport, and the
 * item and safe-area guide switches. The preview iframe and everything it is told
 * stay with the host.
 */

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
			viewport: () => h('iframe', { title: 'host frame' }),
		},
		global,
	});
}

function viewport(wrapper: ReturnType<typeof mountPanel>) {
	return wrapper.get('[data-testid="preview-viewport"]').element;
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
		const style = viewport(wrapper).getAttribute('style') ?? '';

		expect(style).toContain('aspect-ratio: 1080 / 1920');
		expect(style).toContain('width: 25.875vh');
		expect(style).toContain('max-width: 100%');
		expect(viewport(wrapper).classList).toContain('transparent-checkerboard-backdrop');
	});

	it('zooms the viewport to the canvas at a fixed scale', async () => {
		const wrapper = mountPanel();

		await wrapper.get('[aria-label="50% preview zoom"]').trigger('click');

		const style = viewport(wrapper).getAttribute('style') ?? '';
		expect(style).toContain('width: 960px');
		expect(style).toContain('height: 540px');
		expect(style).toContain('max-width: none');
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

	it('collapses by default, and stays open when the host says it cannot', () => {
		expect(mountPanel().findComponent(ScreenSettingsCardStub).props('collapsible')).toBe(true);
		expect(mountPanel({ collapsible: false }).findComponent(ScreenSettingsCardStub).props('collapsible')).toBe(false);
	});
});
