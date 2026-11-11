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
				ScreenSettingsSection: { template: '<section><slot name="actions" :open="true" /><slot /></section>' },
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

/** Copies the Screen's output URL through the hand-out, and answers what reached the clipboard. */
async function copiedOutputUrl(wrapper: Wrapper): Promise<string> {
	await wrapper.get('[data-hand-out="copy"]').trigger('click');
	await wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === 'Copy output URL')!.trigger('click');
	await flushPromises();
	return copyToClipboard.mock.lastCall![0];
}

/** Opens the PNG menu and chooses the capture of `output`. */
async function downloadPng(wrapper: Wrapper, output: string) {
	await wrapper.get('[data-testid="download-output"]').trigger('click');
	const item = wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === `${output} PNG`);
	if (!item)
		throw new Error(`No "${output} PNG" item`);
	await item.trigger('click');
	await flushPromises();
}

// The URL hand-out is the shared component's test; here it is wired once, beside the
// PNG capture this editor keeps, with this surface's own words for a refused capture (#231, #1104).
describe('feature Match Overlay preview aside — output hand-outs', () => {
	it('hands out this Screen\'s fill and key outputs through the shared hand-out', async () => {
		const wrapper = mountAside();

		await wrapper.get('[data-hand-out="copy"]').trigger('click');
		await wrapper.findAll('[role="menuitem"]').find(entry => entry.text() === 'Copy key output URL')!.trigger('click');
		await flushPromises();

		expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(
			`${window.location.origin}/event/1/screen/main?output=key#asset-capability=${capability}`,
			expect.anything(),
		);
	});

	it('points a PNG capture at a URL carrying asset access', async () => {
		const captureWindow = {
			opener: {} as unknown,
			location: { href: '' },
			close: vi.fn(),
		};
		vi.stubGlobal('open', vi.fn(() => captureWindow));
		const wrapper = mountAside();

		await downloadPng(wrapper, 'Fill');

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

		await downloadPng(wrapper, 'Fill');

		expect(toastAdd).toHaveBeenCalledTimes(2);
		expect(toastAdd.mock.lastCall![0]).toMatchObject({
			title: 'Download unavailable',
			description: expect.stringContaining(reason),
		});
	});

	it('disables every hand-out, explaining why, while Graphic Asset publication is blocked', async () => {
		const wrapper = mountAside({ publicationBlocked: true, publicationBlockReason: 'A pinned revision is missing.' });
		const controls = ['[data-hand-out="open"]', '[data-hand-out="copy"]', '[data-testid="download-output"]']
			.map(selector => wrapper.get(selector));

		expect(controls.map(control => [control.attributes('disabled'), control.attributes('title')]))
			.toEqual(Array.from({ length: 3 }, () => ['', 'A pinned revision is missing.']));
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
		message(window.location.origin, window, { type, target, toggle: true });
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
			[target, false],
			[target, true],
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
			'graphics-compositor:preview-animation',
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
		expect(postMessage).toHaveBeenCalledTimes(4);
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

		// Both guides on: the hand-out still copies none.
		await wrapper.get('[data-testid="preview-item-guides"]').trigger('click');
		expect(await copiedOutputUrl(wrapper)).not.toMatch(/embed=preview|guides=1|safe=1/);
	});

	// The stress toggle is editor state: it rides the preview's URL and is never written.
	it('asks its own frame for the Feature Match Stress Dataset while toggled on, and no output URL for it', async () => {
		const wrapper = mountAside();
		const toggle = () => wrapper.get('[data-testid="preview-stress-dataset"]');
		const src = () => wrapper.get('iframe').attributes('src');

		expect(toggle().attributes('aria-pressed')).toBe('false');
		expect(src()).not.toContain('stress=1');
		await toggle().trigger('click');
		expect(toggle().attributes('aria-pressed')).toBe('true');
		expect(src()).toContain('stress=1');
		await toggle().trigger('click');
		expect(src()).not.toContain('stress=1');

		await toggle().trigger('click');
		expect(apiFetch).not.toHaveBeenCalled();
		expect(await copiedOutputUrl(wrapper)).not.toContain('stress=1');
	});

	it('fits the preview to the canvas aspect ratio', () => {
		const wrapper = mountAside({ canvasWidth: 1080, canvasHeight: 1920 });

		expect(wrapper.get('[data-testid="preview-stage"]').attributes('style')).toContain('aspect-ratio: 1080 / 1920');
	});
});

// The editor describes a run and the frame plays it; nothing here writes.
describe('feature Match Overlay preview aside — graphic animation preview', () => {
	const item = (itemId: string): GraphicsSelectionTarget => ({ type: 'item', graphicId: 'feature-match-layout', itemId });

	/** The run last pushed to the frame: a plan, null for a stop, undefined if none was pushed. */
	function lastRun(postMessage: ReturnType<typeof vi.fn>) {
		const runs = postMessage.mock.calls
			.map(([sent]) => sent)
			.filter(sent => sent.type === 'graphics-compositor:preview-animation');
		return runs.length === 0
			? undefined
			: runs[runs.length - 1].plan;
	}

	async function mountPlaying(compositorTarget: GraphicsSelectionTarget, subject: 'composition' | 'item') {
		const wrapper = mountAside({ compositorTarget });
		const postMessage = vi.fn();
		previewFrame(wrapper, { postMessage });
		await wrapper.get(`[data-testid="animation-preview-subject-${subject}"]`).trigger('click');
		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();
		return { wrapper, postMessage };
	}

	it.each([
		[
			'the whole composition, whatever is selected',
			item('wins'),
			'composition',
			undefined,
		],
		[
			'the selected Graphic Item alone',
			item('wins'),
			'item',
			'wins',
		],
	] as const)('plays %s', async (_case, target, subject, itemId) => {
		const { postMessage } = await mountPlaying(target, subject);

		expect(lastRun(postMessage)).toEqual({
			graphicId: 'feature-match-layout',
			...(itemId
				? { itemId }
				: {}),
			scope: 'phase',
			phase: 'enter',
			run: 1,
			speed: 1,
			loop: false,
		});
	});

	// Wiring: the controls live behind the preview panel's one animation control,
	// which is told when their run is playing.
	it('keeps the animation controls behind one control that says a run is playing', async () => {
		const wrapper = mountAside({
			compositorTarget: item('wins'),
		});
		previewFrame(wrapper, {
			postMessage: vi.fn(),
		});
		const toggle = wrapper.get('[data-testid="preview-animation-toggle"]');

		expect(toggle.attributes('aria-expanded')).toBe('false');
		expect(wrapper.get(`[id="${toggle.attributes('aria-controls')}"]`)
			.find('[data-testid="animation-preview-controls"]')
			.exists()).toBe(true);
		expect(toggle.attributes('data-playing')).toBe('false');

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(toggle.attributes('data-playing')).toBe('true');
	});

	it('offers no item run until a Graphic Item is selected', async () => {
		const { wrapper, postMessage } = await mountPlaying({ type: 'canvas' }, 'item');

		expect(wrapper.get('[data-testid="animation-preview-play"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-testid="animation-preview-hint"]').text()).toContain('Select a Graphic Item');
		expect(lastRun(postMessage)).toBeUndefined();
	});

	it.each([
		[
			'stops an item run when another item is selected',
			'item',
			item('clock'),
			null,
		],
		[
			'keeps a composition run through a selection change',
			'composition',
			item('clock'),
			expect.objectContaining({ run: 1 }),
		],
	] as const)('%s', async (_case, subject, next, expected) => {
		const { wrapper, postMessage } = await mountPlaying(item('wins'), subject);

		await wrapper.setProps({ compositorTarget: next });
		await nextTick();

		expect(lastRun(postMessage)).toEqual(expected);
	});

	// A layout declares no Graphic Inputs, so it has no update phase to play.
	it('offers the layout\'s own phases only', () => {
		const wrapper = mountAside();

		expect(wrapper.findAll('[data-testid="animation-preview-phase"] option').map(option => option.text()))
			.toEqual(['Enter', 'On screen', 'Exit']);
	});

	it('marks which subject a run plays', async () => {
		const { wrapper } = await mountPlaying(item('wins'), 'item');

		expect(wrapper.get('[data-testid="animation-preview-subject-item"]').attributes('aria-pressed')).toBe('true');
		expect(wrapper.get('[data-testid="animation-preview-subject-composition"]').attributes('aria-pressed')).toBe('false');
	});

	it('hands a reloaded frame the run in play', async () => {
		const { wrapper, postMessage } = await mountPlaying(item('wins'), 'composition');
		postMessage.mockClear();

		await wrapper.get('iframe').trigger('load');

		expect(lastRun(postMessage)).toEqual(expect.objectContaining({ graphicId: 'feature-match-layout', run: 1 }));
	});
});
