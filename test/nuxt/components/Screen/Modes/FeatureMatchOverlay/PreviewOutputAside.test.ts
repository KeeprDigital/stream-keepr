import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { GRAPHICS_PREVIEW_READY_MESSAGE } from '~/modules/graphics/previewMessages';

const mockCopyToClipboard = vi.fn();
const mockToastAdd = vi.fn();
/** What the Screen Output Asset Capability endpoint issues, if anything. */
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: mockCopyToClipboard }));
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));
mockNuxtImport('useRequestURL', () => () => new URL('http://localhost/'));
mockNuxtImport('$fetch', () => mockApiFetch);

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

const capability = 'HG7fQ2mS4kLp9xRt0ZbNvCyE1JdWqUoA3hMi5nTgKrs';

describe('featureMatchOverlayPreviewOutputAside', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApiFetch.mockResolvedValue({ assetCapability: capability });
	});

	/**
	 * A Feature Match Overlay resolves its media *and* its library fonts through the
	 * Screen Output Asset Capability, so an output URL handed over without one opens
	 * an output that renders everything except them — silently, and permanently
	 * (#231).
	 */
	describe('output URLs an operator is handed', () => {
		it('copies a URL carrying a capability obtained at that moment', async () => {
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="copy-output-key"]').trigger('click');
			await flushPromises();

			expect(mockApiFetch).toHaveBeenCalledWith('/api/events/1/screens/1/asset-capability');
			expect(mockCopyToClipboard).toHaveBeenCalledWith(
				`${window.location.origin}/event/1/screen/main?output=key#asset-capability=${capability}`,
				expect.objectContaining({ successTitle: 'URL copied', successDescription: 'KEY output URL copied.' }),
			);
		});

		it('copies nothing at all when the capability cannot be obtained', async () => {
			mockApiFetch.mockRejectedValue(new Error('unavailable'));
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="copy-output-overlay"]').trigger('click');
			await flushPromises();

			// The empty string is what the clipboard helper reports as having nothing to
			// copy; the operator retries rather than pasting a URL that loses its assets.
			//
			// And the words matter as much as the empty string. This is an asset access
			// refusal, not a clipboard that declined the write — "Failed to copy … to
			// clipboard", which this surface said until #257, sends the operator to the
			// address in their own browser's bar, which is the media-losing URL the
			// refusal exists to withhold (#231, #250).
			expect(mockCopyToClipboard).toHaveBeenCalledWith('', expect.objectContaining({
				nothingToCopyTitle: 'Nothing copied',
				nothingToCopyDescription: expect.stringContaining('Asset access for this Screen could not be obtained'),
			}));
			expect(mockCopyToClipboard.mock.calls.at(-1)![1].nothingToCopyDescription).not.toContain('Failed to copy');
		});

		/**
		 * The quietest hand-out of all: the PNG arrives, looks like a finished output,
		 * and is missing every asset the Screen publishes.
		 */
		it('points a PNG capture at a URL carrying the capability', async () => {
			const captureWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
			vi.stubGlobal('open', vi.fn(() => captureWindow));
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="download-output-fill"]').trigger('click');
			await flushPromises();

			expect(captureWindow.location.href).toBe(
				`${window.location.origin}/event/1/screen/main?output=fill&download=1#asset-capability=${capability}`,
			);
			vi.unstubAllGlobals();
		});

		it('refuses the capture, and says so, when the capability cannot be obtained', async () => {
			mockApiFetch.mockRejectedValue(new Error('unavailable'));
			const captureWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
			vi.stubGlobal('open', vi.fn(() => captureWindow));
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="download-output-fill"]').trigger('click');
			await flushPromises();

			expect(captureWindow.location.href).toBe('');
			expect(captureWindow.close).toHaveBeenCalledOnce();
			expect(mockToastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Download unavailable', color: 'error' }),
			);
			expect(mockToastAdd.mock.calls.at(-1)![0].description).toContain('Asset access');
			vi.unstubAllGlobals();
		});

		/**
		 * A capture runs in a tab, so a pop-up blocker stops it outright — and the
		 * download was announced a moment earlier, leaving the operator watching for a
		 * file that is not coming. Reported as an asset access refusal until #258, which
		 * asks them to retry a capture their browser will refuse identically.
		 */
		it('names the browser, not asset access, when the capture tab is blocked', async () => {
			vi.stubGlobal('open', vi.fn(() => null));
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="download-output-fill"]').trigger('click');
			await flushPromises();

			// Named before it is read: a run where nothing was reported should say so,
			// not die dereferencing a call that was never made (#273).
			expect(mockToastAdd).toHaveBeenCalled();
			const reported = mockToastAdd.mock.calls.at(-1)![0];
			expect(reported.title).toBe('Download unavailable');
			expect(reported.description).toContain('pop-up');
			expect(reported.description).not.toContain('Asset access');
			vi.unstubAllGlobals();
		});
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

	/**
	 * The case a hand-rolled `message.source === contentWindow` comparison gets
	 * wrong. A frame that is gone leaves `contentWindow` null and a `MessageEvent`
	 * carries a null source unless a window sent it, so comparing the two matches —
	 * and the aside acts on a selection from nobody at exactly the moment there is
	 * nobody entitled to send one. The shared guard requires the expected sender to
	 * exist, which is why both selections now go through it (#252).
	 */
	it('accepts no selection at all once there is no frame that could have sent one', async () => {
		const wrapper = await mountComponent();
		const previewFrame = wrapper.get('iframe').element;
		Object.defineProperty(previewFrame, 'contentWindow', { configurable: true, value: null });

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: null,
			data: { type: 'feature-match-overlay:select', target: { type: 'source', itemId: 'spoofed' } },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: null,
			data: { type: 'graphics-compositor:select', target: { type: 'item', graphicId: 'g', itemId: 'spoofed' } },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')).toBeUndefined();
		expect(wrapper.emitted('selectCompositorTarget')).toBeUndefined();
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

	/**
	 * The frame's `message` listeners are installed when its app mounts, and this
	 * application renders on the client — so the iframe's `load` event, which the
	 * push above rides, fires before that as often as after it. A push that lost
	 * that race was dropped in silence and left the preview rendering the Screen's
	 * stored configuration, which does not look like a missed message (#235).
	 */
	it('pushes again when the frame reports that it is listening', async () => {
		const wrapper = await mountComponent();
		const previewFrame = wrapper.get('iframe').element;
		const postMessage = vi.fn();
		Object.defineProperty(previewFrame, 'contentWindow', {
			configurable: true,
			value: { postMessage },
		});

		// No `load` at all: the frame speaks first, which is the case the handshake
		// exists for.
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: previewFrame.contentWindow,
			data: { type: GRAPHICS_PREVIEW_READY_MESSAGE },
		}));
		await nextTick();

		expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
			'feature-match-overlay:preview-config',
			'feature-match-overlay:selected-target',
			'graphics-compositor:selected-target',
		]);
	});

	it('answers no ready announced by a window it did not embed', async () => {
		const wrapper = await mountComponent();
		const previewFrame = wrapper.get('iframe').element;
		const postMessage = vi.fn();
		Object.defineProperty(previewFrame, 'contentWindow', {
			configurable: true,
			value: { postMessage },
		});

		// A window this aside never embedded, rather than this one: the file leaves
		// its mounted components alive, and `window` is the frame several of them
		// were given, so announcing as `window` would be announcing to those too.
		const stranger = { postMessage: vi.fn() } as unknown as MessageEventSource;

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: stranger,
			data: { type: GRAPHICS_PREVIEW_READY_MESSAGE },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: previewFrame.contentWindow,
			data: { type: GRAPHICS_PREVIEW_READY_MESSAGE },
		}));
		await nextTick();

		expect(postMessage).not.toHaveBeenCalled();
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
