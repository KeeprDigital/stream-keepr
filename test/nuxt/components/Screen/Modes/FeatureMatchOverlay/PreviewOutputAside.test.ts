import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

const mockCopyToClipboard = vi.fn();
const mockToastAdd = vi.fn();

mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: mockCopyToClipboard }));
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));
mockNuxtImport('useRequestURL', () => () => new URL('http://localhost/'));

const ScreenSettingsCardStub = defineComponent({
	template: '<section><slot name="actions" :open="true" /><slot /></section>',
});

const SlotOnlyStub = defineComponent({
	template: '<div><slot /></div>',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		disabled: { type: Boolean, required: false },
		title: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" :title="title" @click="$emit(\'click\')"><slot /></button>',
});

const UPopoverStub = defineComponent({
	template: '<div><slot /><slot name="content" /></div>',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

async function mountComponent(props: {
	publicationBlocked?: boolean;
	publicationBlockReason?: string;
	compositorTarget?: GraphicsSelectionTarget;
} = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/PreviewOutputAside.vue';
	const { default: PreviewOutputAside } = await import(componentPath);
	return mount(PreviewOutputAside, {
		props: {
			eventId: 1,
			screen: {
				id: 1,
				slug: 'main',
				screenConfig: { width: 1920, height: 1080 },
			} as Screen,
			config: structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG),
			selectedTarget: { type: 'canvas' },
			compositorTarget: { type: 'canvas' },
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UFormField: SlotOnlyStub,
				USwitch: USwitchStub,
				UFieldGroup: true,
				UButton: UButtonStub,
				UPopover: UPopoverStub,
				UBadge: true,
				UInput: true,
			},
		},
	});
}

describe('featureMatchOverlayPreviewOutputAside', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('accepts selections only from its own same-origin preview frame', async () => {
		const wrapper = await mountComponent();
		const previewFrame = wrapper.get('iframe').element;
		Object.defineProperty(previewFrame, 'contentWindow', { configurable: true, value: window });
		const previewWindow = previewFrame.contentWindow;
		const target = { type: 'source', itemId: 'main-source' };

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: previewWindow,
			data: { type: 'feature-match-overlay:select', target },
		}));
		await nextTick();
		expect(wrapper.emitted('selectTarget')).toEqual([[target]]);

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: null,
			data: { type: 'feature-match-overlay:select', target: { type: 'source', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: previewWindow,
			data: { type: 'feature-match-overlay:select', target: { type: 'source', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: previewWindow,
			data: { type: 'feature-match-overlay:select', target: { type: 'unsupported' } },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')).toEqual([[target]]);
	});

	it('accepts a shared Graphic Item selection only from its own same-origin preview frame', async () => {
		const wrapper = await mountComponent();
		const previewFrame = wrapper.get('iframe').element;
		Object.defineProperty(previewFrame, 'contentWindow', { configurable: true, value: window });
		const previewWindow = previewFrame.contentWindow;
		const target = { type: 'item', graphicId: 'feature-match-layout', itemId: 'shared-clock' };

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: previewWindow,
			data: { type: 'graphics-compositor:select', target },
		}));
		await nextTick();
		expect(wrapper.emitted('selectCompositorTarget')).toEqual([[target]]);

		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: previewWindow,
			data: { type: 'graphics-compositor:select', target: { type: 'item', graphicId: 'g', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: null,
			data: { type: 'graphics-compositor:select', target: { type: 'item', graphicId: 'g', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: previewWindow,
			data: { type: 'graphics-compositor:select', target: { type: 'item', graphicId: 'g' } },
		}));
		await nextTick();

		expect(wrapper.emitted('selectCompositorTarget')).toEqual([[target]]);
	});

	it('pushes both selections into the preview frame it embedded', async () => {
		// Two authoring surfaces, two vocabularies, one preview. The frame needs both
		// to mark what is under authoring, and neither can be expressed in the other.
		const wrapper = await mountComponent();
		const previewFrame = wrapper.get('iframe').element;
		const postMessage = vi.fn();
		Object.defineProperty(previewFrame, 'contentWindow', {
			configurable: true,
			value: { postMessage },
		});

		await wrapper.get('iframe').trigger('load');

		expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
			'feature-match-overlay:preview-config',
			'feature-match-overlay:selected-target',
			'graphics-compositor:selected-target',
		]);

		postMessage.mockClear();
		await wrapper.setProps({ compositorTarget: { type: 'item', graphicId: 'feature-match-layout', itemId: 'wins' } });
		await nextTick();

		expect(postMessage).toHaveBeenCalledWith({
			type: 'graphics-compositor:selected-target',
			target: { type: 'item', graphicId: 'feature-match-layout', itemId: 'wins' },
		}, window.location.origin);
	});

	it('asks its own preview frame for guides, and asks for them nowhere else', async () => {
		// Editor-only guides are carried on the preview's URL, and a copyable output
		// URL is the same Screen without them — which is what keeps a guide off air.
		const wrapper = await mountComponent();

		expect(wrapper.get('iframe').attributes('src')).toContain('preview=1');
		expect(wrapper.get('iframe').attributes('src')).toContain('guides=1');
		expect(wrapper.get('iframe').attributes('src')).not.toContain('safe=1');

		await wrapper.get('[data-testid="preview-safe-area-guides"]').trigger('click');
		expect(wrapper.get('iframe').attributes('src')).toContain('safe=1');

		await wrapper.get('[data-testid="preview-item-guides"]').trigger('click');
		expect(wrapper.get('iframe').attributes('src')).not.toContain('guides=1');

		const outputUrls = wrapper.findAll('u-input-stub').map(input => input.attributes('modelvalue') ?? '');
		expect(outputUrls.length).toBeGreaterThan(0);
		for (const url of outputUrls) {
			expect(url).not.toContain('preview=1');
			expect(url).not.toContain('guides=1');
			expect(url).not.toContain('safe=1');
		}
	});

	it('disables output URL and capture actions when Graphic Asset publication is blocked', async () => {
		const wrapper = await mountComponent({
			publicationBlocked: true,
			publicationBlockReason: 'A pinned revision is missing.',
		});
		const blockedButtons = wrapper.findAll('button[disabled]');

		expect(blockedButtons.length).toBeGreaterThanOrEqual(3);
		expect(blockedButtons.every(button => button.attributes('title') === 'A pinned revision is missing.'))
			.toBe(true);
		for (const button of blockedButtons)
			await button.trigger('click');
		expect(mockCopyToClipboard).not.toHaveBeenCalled();
		expect(mockToastAdd).not.toHaveBeenCalled();
	});
});
