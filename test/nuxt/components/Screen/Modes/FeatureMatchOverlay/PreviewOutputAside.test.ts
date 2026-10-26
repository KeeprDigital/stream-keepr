import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import PreviewOutputAside from '~/components/Screen/Modes/FeatureMatchOverlay/PreviewOutputAside.vue';
import { GRAPHICS_PREVIEW_READY_MESSAGE } from '~/modules/graphics/previewMessages';

const copyToClipboard = vi.fn();
const toastAdd = vi.fn();
const { apiFetch } = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));

mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard }));
mockNuxtImport('useToast', () => () => ({ add: toastAdd }));
mockNuxtImport('useRequestURL', () => () => new URL('http://localhost/'));
mockNuxtImport('$fetch', () => apiFetch);

function mountAside(props: {
	publicationBlocked?: boolean;
	publicationBlockReason?: string;
	compositorTarget?: GraphicsSelectionTarget;
	canvasWidth?: number;
	canvasHeight?: number;
} = {}) {
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
			canvasWidth: 1920,
			canvasHeight: 1080,
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				// Its popovers open by default here, so every hand-out control is on screen.
				UPopover: { template: '<div><slot /><slot name="content" /></div>' },
				ScreenSettingsCard: { template: '<section><slot name="actions" :open="true" /><slot /></section>' },
				GraphicsCanvasManipulationOverlay: true,
			},
		},
	});
}

type Wrapper = ReturnType<typeof mountAside>;

/** The preview frame, with `contentWindow` replaced so a test can be or watch its sender. */
function previewFrame(wrapper: Wrapper, contentWindow: unknown) {
	const frame = wrapper.get('iframe').element;
	Object.defineProperty(frame, 'contentWindow', { configurable: true, value: contentWindow });
	return frame;
}

function message(origin: string, source: MessageEventSource | null, data: object) {
	window.dispatchEvent(new MessageEvent('message', { origin, source, data }));
}

const capability = 'HG7fQ2mS4kLp9xRt0ZbNvCyE1JdWqUoA3hMi5nTgKrs';

beforeEach(() => {
	vi.clearAllMocks();
	apiFetch.mockResolvedValue({ assetCapability: capability });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// How a hand-out obtains and carries the Screen Output Asset Capability is
// `useScreenOutputAccessUrl`'s test; here each control is wired to it once, with
// this surface's own words for what went wrong (#231).
describe('feature Match Overlay preview aside — output hand-outs', () => {
	it('copies an output URL carrying asset access, saying nothing beyond the clipboard', async () => {
		const wrapper = mountAside();

		await wrapper.get('[data-testid="copy-output-key"]').trigger('click');
		await flushPromises();

		expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(
			`${window.location.origin}/event/1/screen/main?output=key#asset-capability=${capability}`,
			expect.objectContaining({ successDescription: 'KEY output URL copied.' }),
		);
		expect(toastAdd).not.toHaveBeenCalled();
	});

	it('copies nothing when asset access is refused, and says so rather than blaming the clipboard (#257)', async () => {
		apiFetch.mockRejectedValue(new Error('unavailable'));
		const wrapper = mountAside();

		await wrapper.get('[data-testid="copy-output-overlay"]').trigger('click');
		await flushPromises();

		expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith('', expect.objectContaining({
			nothingToCopyDescription: expect.stringContaining('Asset access for this Screen could not be obtained'),
		}));
	});

	it('points a PNG capture at a URL carrying asset access', async () => {
		const captureWindow = {
			opener: {} as unknown,
			location: { href: '' },
			close: vi.fn(),
		};
		vi.stubGlobal('open', vi.fn(() => captureWindow));
		const wrapper = mountAside();

		await wrapper.get('[data-testid="download-output-fill"]').trigger('click');
		await flushPromises();

		expect(captureWindow.location.href).toBe(`${window.location.origin}/event/1/screen/main?output=fill&download=1#asset-capability=${capability}`);
		expect(toastAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Preparing download' }));
	});

	// Two reports: the announcement, then exactly one refusal naming the right cause (#258).
	it.each([
		[
			'asset access is refused',
			() => {
				apiFetch.mockRejectedValue(new Error('unavailable'));
				vi.stubGlobal('open', vi.fn(() => ({
					opener: {},
					location: { href: '' },
					close: vi.fn(),
				})));
			},
			'Asset access',
		],
		[
			'the browser blocks the capture tab',
			() => vi.stubGlobal('open', vi.fn(() => null)),
			'pop-up',
		],
	])('refuses the capture, and says why, when %s', async (_, arrange, reason) => {
		arrange();
		const wrapper = mountAside();

		await wrapper.get('[data-testid="download-output-fill"]').trigger('click');
		await flushPromises();

		expect(toastAdd).toHaveBeenCalledTimes(2);
		expect(toastAdd.mock.lastCall![0]).toMatchObject({
			title: 'Download unavailable',
			description: expect.stringContaining(reason),
		});
	});

	it('disables every hand-out, explaining why, while Graphic Asset publication is blocked', async () => {
		const wrapper = mountAside({ publicationBlocked: true, publicationBlockReason: 'A pinned revision is missing.' });
		const blocked = wrapper.findAll('button[disabled]');

		expect(blocked.length).toBeGreaterThanOrEqual(3);
		expect(blocked.every(button => button.attributes('title') === 'A pinned revision is missing.')).toBe(true);
	});
});

// The sender guard itself is `graphicsPreviewMessages`' and
// `featureMatchOverlayPreviewMessages`' test; here the aside routes both selection
// vocabularies through it. Message types are wire literals, so a rename fails (#260).
describe('feature Match Overlay preview aside — its preview frame', () => {
	it.each([
		[
			'a Source Item selection',
			'feature-match-overlay:select',
			'selectTarget',
			{ type: 'source', itemId: 'main-source' },
		],
		[
			'a shared Graphic Item selection',
			'graphics-compositor:select',
			'selectCompositorTarget',
			{ type: 'item', graphicId: 'feature-match-layout', itemId: 'shared-clock' },
		],
	])('accepts %s only from its own same-origin frame', async (_, type, event, target) => {
		const wrapper = mountAside();
		previewFrame(wrapper, window);

		message(window.location.origin, window, { type, target });
		message('https://example.invalid', window, {
			type,
			target: { ...target, itemId: 'spoofed' },
		});
		message(window.location.origin, null, {
			type,
			target: { ...target, itemId: 'spoofed' },
		});
		await nextTick();

		expect(wrapper.emitted(event)).toEqual([
			[target],
		]);
	});

	// A gone frame has a null `contentWindow`, which a bare `source === contentWindow` matches (#252).
	it('accepts no selection once there is no frame that could have sent one', async () => {
		const wrapper = mountAside();
		previewFrame(wrapper, null);

		message(window.location.origin, null, {
			type: 'feature-match-overlay:select',
			target: { type: 'source', itemId: 'spoofed' },
		});
		message(window.location.origin, null, {
			type: 'graphics-compositor:select',
			target: { type: 'item', graphicId: 'g', itemId: 'spoofed' },
		});
		await nextTick();

		expect(wrapper.emitted('selectTarget')).toBeUndefined();
		expect(wrapper.emitted('selectCompositorTarget')).toBeUndefined();
	});

	it('pushes the config and both selections on load, and a changed selection after', async () => {
		const wrapper = mountAside();
		const postMessage = vi.fn();
		previewFrame(wrapper, { postMessage });

		await wrapper.get('iframe').trigger('load');
		expect(postMessage.mock.calls.map(([sent]) => sent.type)).toEqual([
			'feature-match-overlay:preview-config',
			'feature-match-overlay:selected-target',
			'graphics-compositor:selected-target',
		]);

		postMessage.mockClear();
		await wrapper.setProps({
			compositorTarget: { type: 'item', graphicId: 'feature-match-layout', itemId: 'wins' },
		});
		expect(postMessage).toHaveBeenCalledWith({
			type: 'graphics-compositor:selected-target',
			target: { type: 'item', graphicId: 'feature-match-layout', itemId: 'wins' },
		}, window.location.origin);
	});

	// The frame may mount its listeners after `load` fires, so it announces readiness (#235).
	it('pushes again when its own frame announces it is listening, and for no other window', async () => {
		const wrapper = mountAside();
		const postMessage = vi.fn();
		const frame = previewFrame(wrapper, { postMessage });
		const stranger = {
			postMessage: vi.fn(),
		} as unknown as MessageEventSource;

		message(window.location.origin, stranger, { type: GRAPHICS_PREVIEW_READY_MESSAGE });
		message('https://example.invalid', frame.contentWindow, { type: GRAPHICS_PREVIEW_READY_MESSAGE });
		await nextTick();
		expect(postMessage).not.toHaveBeenCalled();

		message(window.location.origin, frame.contentWindow, { type: GRAPHICS_PREVIEW_READY_MESSAGE });
		await nextTick();
		expect(postMessage).toHaveBeenCalledTimes(3);
	});

	// Guides ride the preview's URL only, which is what keeps them off air.
	it('asks its own frame for guides, and no output URL for any', async () => {
		const wrapper = mountAside();
		const src = () => wrapper.get('iframe').attributes('src');

		expect(src()).toContain('guides=1');
		expect(src()).not.toContain('safe=1');
		await wrapper.get('[data-testid="preview-safe-area-guides"]').trigger('click');
		expect(src()).toContain('safe=1');
		await wrapper.get('[data-testid="preview-item-guides"]').trigger('click');
		expect(src()).not.toContain('guides=1');

		const outputUrls = wrapper.findAll('input').map(input => (input.element as HTMLInputElement).value).filter(Boolean);
		expect(outputUrls.length).toBeGreaterThan(0);
		expect(outputUrls.some(url => /embed=preview|guides=1|safe=1/.test(url))).toBe(false);
	});

	it('fits the preview to the canvas aspect ratio', () => {
		const wrapper = mountAside({ canvasWidth: 1080, canvasHeight: 1920 });

		expect(wrapper.get('iframe').element.parentElement?.getAttribute('style')).toContain('aspect-ratio: 1080 / 1920');
	});
});
