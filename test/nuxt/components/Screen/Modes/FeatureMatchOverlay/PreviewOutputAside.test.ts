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

async function mountComponent(props: {
	publicationBlocked?: boolean;
	publicationBlockReason?: string;
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
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UFormField: true,
				USwitch: true,
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
		const target = { type: 'widget', itemId: 'top-bar', childId: 'top-name-record' };

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
			data: { type: 'feature-match-overlay:select', target: { type: 'layer', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: previewWindow,
			data: { type: 'feature-match-overlay:select', target: { type: 'layer', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: previewWindow,
			data: { type: 'feature-match-overlay:select', target: { type: 'unsupported' } },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')).toEqual([[target]]);
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
