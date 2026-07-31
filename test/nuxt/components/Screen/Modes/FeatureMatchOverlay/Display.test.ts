import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createFeatureMatchLayoutComposition, FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

const mockConfig = ref<FeatureMatchOverlayModeConfig>(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
const mockOutputMode = ref<FeatureMatchOverlayOutput>('overlay');
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockScreen = ref({ screenConfig: { width: 1920, height: 1080 } });
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockContentUrlsSettled = ref(true);

mockNuxtImport('useScreenContext', () => () => ({
	outputMode: mockOutputMode,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
	screen: mockScreen,
}));

mockNuxtImport('useFeatureMatchOverlayModeData', () => () => ({
	config: computed(() => mockConfig.value),
	match: ref(null),
	matchState: ref(null),
	sourceMatch: ref(null),
	round: ref(null),
	phase: ref(null),
	event: ref(null),
	loading: mockLoading,
	error: mockError,
}));

mockNuxtImport('useClockDisplay', () => () => ({
	displayTime: computed(() => '12:34'),
}));

mockNuxtImport('useScreenGraphicAssetContentUrls', () => () => ({
	contentUrl: (reference: { assetId: string; revisionId: string }) =>
		`/private-assets/${reference.assetId}/${reference.revisionId}`,
	contentUrlsSettled: mockContentUrlsSettled,
}));

async function mountComponent() {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				FeatureMatchOverlayFrameAnimation: true,
				FeatureMatchOverlayFrameMedia: true,
				FeatureMatchOverlayGameWinsGraphicItem: true,
				FeatureMatchOverlayStatusGraphicItem: true,
				FeatureMatchOverlayTemplateLines: true,
			},
		},
	});
}

function groupLayerConfig(): FeatureMatchOverlayModeConfig {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	config.layout.items = [
		{
			id: 'framed-group',
			type: 'graphic-group',
			label: 'Framed Group',
			visible: true,
			x: 10,
			y: 20,
			width: 300,
			height: 80,
			overflow: 'clip',
			arrangement: { mode: 'canvas', padding: 0 },
			surfaceStyle: {
				backgroundColor: '#111111',
				backgroundOpacity: 0.5,
				backgroundGradient: 'linear-gradient(90deg, #b80054, #7f22f6)',
				borderVisible: true,
				borderColor: '#ff00aa',
				borderWidth: 4,
				borderRadius: 12,
				glowSize: 8,
				glowOpacity: 1,
			},
			defaultChildSurfaceStyle: {
				textColor: '#ffffff',
				fontSize: 20,
			},
			children: [
				{
					id: 'full-child',
					type: 'graphic-item',
					label: 'Full Child',
					visible: true,
					graphicItem: { type: 'clock' },
					layout: { mode: 'canvas', x: 0, y: 0, width: 300, height: 80 },
				},
			],
		},
	];
	return config;
}

describe('featureMatchOverlayDisplay', () => {
	describe('the host-owned layer around the shared item tree', () => {
		it('draws the Frame and the Source Items beneath the composed tree', async () => {
			// The Frame is the continuous area that sits behind and around everything
			// else, and a Source Item shows an external video feed through it. Both are
			// host-owned, so both are drawn by this component rather than composed by
			// the shared compositor — and both come first in document order.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [getGraphicItemDefinition('clock').createDefault({
					id: 'clock',
					label: 'Clock',
					canvasWidth: 1920,
					canvasHeight: 1080,
				})],
			};
			mockConfig.value = config;

			const wrapper = await mountComponent();
			const html = wrapper.html();
			const frame = html.indexOf('frame-layer');
			const source = html.indexOf('data-graphic-item-id');
			const composition = html.indexOf('feature-match-overlay__composition');

			expect(frame).toBeGreaterThanOrEqual(0);
			expect(source).toBeGreaterThan(frame);
			expect(composition).toBeGreaterThan(source);
		});

		it('never covers the host-owned layer with a backdrop of its own', async () => {
			// The composed tree is mounted above the Frame, the Source Items, and the
			// legacy widgets. A Fill or Key Output's black backdrop painted here would
			// cover all of them — an operator switching an existing overlay to Fill would
			// get solid black on air. Checked in every output, because the Overlay
			// Output's transparent backdrop hides the mistake.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [getGraphicItemDefinition('clock').createDefault({
					id: 'clock',
					label: 'Clock',
					canvasWidth: 1920,
					canvasHeight: 1080,
				})],
			};

			for (const output of ['overlay', 'fill', 'key'] as const) {
				mockConfig.value = config;
				mockOutputMode.value = output;

				const wrapper = await mountComponent();
				const style = wrapper.get('.feature-match-overlay__composition').attributes('style') ?? '';

				expect(style).not.toContain('#000000');
				expect(style).not.toContain('rgb(0, 0, 0)');
				// The host places the layer, so the model must not position it either.
				expect(style).not.toContain('position: relative');
				// It is still the tree that renders, in every output.
				expect(wrapper.get('[data-graphic-item-kind="clock"]').text()).toBe('12:34');
			}
		});

		it('punches a Source Item cutout through the Frame rather than through the tree', async () => {
			// The cutout is a mask on the Frame's own layers. The composed tree is a
			// sibling above it and is never masked, so a Graphic Item over a Source Item
			// still paints.
			mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);

			const wrapper = await mountComponent();

			expect(wrapper.find('mask').exists()).toBe(true);
			expect(wrapper.get('.feature-match-overlay__composition').attributes('mask')).toBeUndefined();
		});

		it('renders the shared item tree even when the layout has no legacy items', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [getGraphicItemDefinition('clock').createDefault({
					id: 'clock',
					label: 'Clock',
					canvasWidth: 1920,
					canvasHeight: 1080,
				})],
			};
			mockConfig.value = config;

			const wrapper = await mountComponent();

			// The clock string comes from the host, so the composed item renders it
			// without any Graphic Text Template having been authored.
			expect(wrapper.get('[data-graphic-item-kind="clock"]').text()).toBe('12:34');
		});
	});

	describe('the editor preview guide layer', () => {
		function guidedConfig(): FeatureMatchOverlayModeConfig {
			// A layout with both authoring surfaces populated: the Source Items the
			// default preset carries, and one shared Graphic Item in the composition.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [getGraphicItemDefinition('clock').createDefault({
					id: 'shared-clock',
					label: 'Shared Clock',
					canvasWidth: 1920,
					canvasHeight: 1080,
				})],
			};
			return config;
		}

		it('draws no guide of any kind on a live Screen Output', async () => {
			// Preview guides never appear in live Screen Outputs or captures. A live
			// output is exactly a Screen that was not asked for guides, and the check
			// runs in every output because none of them changes the answer.
			for (const output of ['overlay', 'fill', 'key'] as const) {
				mockConfig.value = guidedConfig();
				mockOutputMode.value = output;

				const wrapper = await mountComponent();

				expect(wrapper.find('.guide-layer').exists()).toBe(false);
				expect(wrapper.find('[data-item-guide]').exists()).toBe(false);
				expect(wrapper.find('[data-safe-area-guide]').exists()).toBe(false);
				expect(wrapper.find('[aria-label="Select canvas"]').exists()).toBe(false);
			}
		});

		it('guides both authoring surfaces from one layer with one canvas catch-all', async () => {
			// Two guide layers over one canvas would leave whichever landed underneath
			// unclickable, and each would contribute a second catch-all swallowing the
			// other's guides. The host-owned guides come last, so a Source Item stays
			// selectable where it overlaps a shared Graphic Item.
			mockConfig.value = guidedConfig();
			mockPreviewGuides.value = true;

			const wrapper = await mountComponent();

			expect(wrapper.findAll('.guide-layer')).toHaveLength(1);
			expect(wrapper.findAll('[aria-label="Select canvas"]')).toHaveLength(1);
			expect(wrapper.find('[data-item-guide="shared-clock"]').exists()).toBe(true);
			expect(wrapper.findAll('.graphic-item-guide--source').length).toBeGreaterThan(0);

			const html = wrapper.html();
			expect(html.indexOf('aria-label="Select canvas"')).toBeLessThan(html.indexOf('data-item-guide'));
			expect(html.indexOf('data-item-guide')).toBeLessThan(html.indexOf('graphic-item-guide--source'));
		});

		it('reports a shared Graphic Item click back to the editor in the compositor"s vocabulary', async () => {
			mockConfig.value = guidedConfig();
			mockPreviewGuides.value = true;
			const postMessage = vi.spyOn(window.parent, 'postMessage');

			const wrapper = await mountComponent();
			await wrapper.get('[data-item-guide="shared-clock"]').trigger('click');

			expect(postMessage).toHaveBeenCalledWith(
				{
					type: 'graphics-compositor:select',
					target: { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: 'shared-clock' },
				},
				window.location.origin,
			);
			postMessage.mockRestore();
		});

		it('marks the shared Graphic Item the editor selected', async () => {
			mockConfig.value = guidedConfig();
			mockPreviewGuides.value = true;

			const wrapper = await mountComponent();
			expect(wrapper.get('[data-item-guide="shared-clock"]').classes()).not.toContain('is-selected');

			window.dispatchEvent(new MessageEvent('message', {
				origin: window.location.origin,
				source: window.parent,
				data: {
					type: 'graphics-compositor:selected-target',
					target: { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: 'shared-clock' },
				},
			}));
			await nextTick();

			expect(wrapper.get('[data-item-guide="shared-clock"]').classes()).toContain('is-selected');
		});

		it('draws advisory safe areas without offering anything to select', async () => {
			// The safe-area guides are advisory: they never clip or constrain an
			// authored Graphic Item, and with item guides switched off there is no
			// selection to make, so nothing in the layer is clickable.
			mockConfig.value = guidedConfig();
			mockPreviewSafeAreas.value = true;

			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-safe-area-guide]').map(guide => guide.attributes('data-safe-area-guide')))
				.toEqual(['action-safe', 'title-safe']);
			expect(wrapper.find('[aria-label="Select canvas"]').exists()).toBe(false);
			expect(wrapper.find('[data-item-guide]').exists()).toBe(false);
		});
	});

	beforeEach(() => {
		mockConfig.value = groupLayerConfig();
		mockOutputMode.value = 'overlay';
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = { screenConfig: { width: 1920, height: 1080 } };
		mockLoading.value = false;
		mockError.value = null;
		mockContentUrlsSettled.value = true;
		Object.defineProperty(document, 'fonts', {
			configurable: true,
			value: {
				add: vi.fn(),
				delete: vi.fn(),
				load: vi.fn().mockResolvedValue([]),
				check: vi.fn().mockReturnValue(true),
				ready: Promise.resolve(),
			},
		});
	});

	it('renders Graphic Group appearance above clipped child Graphic Items', async () => {
		const wrapper = await mountComponent();
		const group = wrapper.get('.feature-match-overlay-graphic-group');
		const groupElement = group.element as HTMLElement;
		const children = Array.from(groupElement.children);

		expect(groupElement.style.overflow).toBe('visible');
		expect(groupElement.style.background).toBe('');
		expect(groupElement.style.borderTop).toBe('');
		expect(children[0]?.classList.contains('feature-match-overlay-graphic-group__backdrop')).toBe(true);
		expect(children[1]?.classList.contains('feature-match-overlay-graphic-group__children')).toBe(true);
		expect(children[2]?.classList.contains('feature-match-overlay-graphic-group__frame')).toBe(true);

		const childLayer = wrapper.get('.feature-match-overlay-graphic-group__children');
		const child = wrapper.get('.feature-match-overlay-graphic-group__child');
		const backdrop = wrapper.get('.feature-match-overlay-graphic-group__backdrop');
		const frame = wrapper.get('.feature-match-overlay-graphic-group__frame');
		const childLayerElement = childLayer.element as HTMLElement;
		const childElement = child.element as HTMLElement;
		const backdropElement = backdrop.element as HTMLElement;
		const frameElement = frame.element as HTMLElement;

		expect(childLayerElement.style.overflow).toBe('hidden');
		expect(backdropElement.style.opacity).toBe('0.5');
		expect(childElement.style.background).toBe('transparent');
		expect(frameElement.style.borderTopWidth).toBe('4px');
		expect(frameElement.style.borderTopStyle).toBe('solid');
		expect(frameElement.style.boxShadow).toContain('0 0 8px');
		expect(frameElement.style.zIndex).toBe('2');
	});

	it('renders every Graphic Item kind in authoritative back-to-front list order', async () => {
		const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const source = base.layout.items.find(item => item.type === 'source')!;
		const graphicItem = base.layout.items.find(item => item.type === 'graphic-item')!;
		const group = base.layout.items.find(item => item.type === 'graphic-group')!;
		base.layout.items = [
			{ ...graphicItem, id: 'back-graphicItem' },
			{
				id: 'middle-media',
				type: 'media',
				label: 'Middle media',
				visible: true,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				mediaKind: 'image',
				fit: 'cover',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 1,
			},
			{ ...source, id: 'front-source' },
			{ ...group, id: 'front-group' },
		];
		mockConfig.value = base;

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-graphic-item-id]').map(item => item.attributes('data-graphic-item-id')))
			.toEqual(['back-graphicItem', 'middle-media', 'front-source', 'front-group']);
	});

	it('renders an exact silent-video Media Graphic Item inside its Graphic Group', async () => {
		const config = groupLayerConfig();
		const group = config.layout.items[0];
		if (group?.type !== 'graphic-group')
			throw new Error('Expected a Graphic Group fixture');
		group.children = [{
			id: 'sponsor-loop',
			type: 'media',
			label: 'Sponsor loop',
			visible: true,
			layout: { mode: 'canvas', x: 10, y: 8, width: 240, height: 120 },
			asset: {
				assetId: 'sponsor-video-asset' as never,
				revisionId: 'sponsor-video-revision-5' as never,
			},
			mediaKind: 'silent-video',
			fit: 'cover',
			focalPosition: { horizontal: 0.35, vertical: 0.6 },
			opacity: 0.8,
			loop: false,
			playbackRate: 1.25,
			videoCompatibility: 'all-supported',
			videoTarget: 'safari',
		}];
		mockConfig.value = config;

		const wrapper = await mountComponent();

		const childLayer = wrapper.get('.feature-match-overlay-graphic-group__children');
		const video = childLayer.get('video');
		expect(video.attributes('src')).toBe(
			'/private-assets/sponsor-video-asset/sponsor-video-revision-5',
		);
		expect(video.attributes()).toMatchObject({
			autoplay: '',
			muted: '',
			playsinline: '',
			preload: 'auto',
		});
		expect((video.element as HTMLVideoElement).loop).toBe(false);
		expect((video.element as HTMLVideoElement).playbackRate).toBe(1.25);
	});

	it('hides preview and output rendering until every exact font revision is ready', async () => {
		const firstItem = mockConfig.value.layout.items[0]!;
		if (firstItem.type !== 'graphic-group')
			throw new Error('Expected Graphic Group test fixture');
		firstItem.surfaceStyle = {
			font: {
				kind: 'asset',
				reference: {
					assetId: 'font-asset' as never,
					revisionId: 'font-revision-2' as never,
				},
			},
		};
		let finishLoad!: () => void;
		const load = new Promise<void>((resolve) => {
			finishLoad = resolve;
		});
		class MockFontFace {
			constructor(
				public family: string,
				public source: string,
			) {}

			async load() {
				await load;
				return this;
			}
		}
		vi.stubGlobal('FontFace', MockFontFace);

		const wrapper = await mountComponent();
		const overlay = wrapper.get('.feature-match-overlay');
		expect(overlay.attributes('data-font-ready')).toBe('false');
		expect(overlay.attributes('data-export-ready')).toBe('false');
		expect((overlay.element as HTMLElement).style.visibility).toBe('hidden');

		finishLoad();
		await load;
		await vi.waitFor(() => {
			expect(overlay.attributes('data-font-ready')).toBe('true');
		});
		expect(overlay.attributes('data-export-ready')).toBe('true');
		expect((document.fonts.add as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
	});

	it('retries exact font loading when private content URLs finish resolving', async () => {
		const firstItem = mockConfig.value.layout.items[0]!;
		if (firstItem.type !== 'graphic-group')
			throw new Error('Expected Graphic Group test fixture');
		firstItem.surfaceStyle = {
			font: {
				kind: 'asset',
				reference: {
					assetId: 'font-asset' as never,
					revisionId: 'font-revision-3' as never,
				},
			},
		};
		mockContentUrlsSettled.value = false;
		const load = vi.fn().mockResolvedValue(undefined);
		class MockFontFace {
			constructor(
				public family: string,
				public source: string,
			) {}

			load = load;
		}
		vi.stubGlobal('FontFace', MockFontFace);

		const wrapper = await mountComponent();
		expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('false');
		expect(load).not.toHaveBeenCalled();

		mockContentUrlsSettled.value = true;
		await vi.waitFor(() => {
			expect(load).toHaveBeenCalled();
			expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
		});
	});

	it('marks restricted video output not ready outside a proven Chromium target', async () => {
		mockConfig.value.layout.items = [{
			id: 'restricted-video',
			type: 'media',
			label: 'Restricted VP9 alpha',
			visible: true,
			x: 0,
			y: 0,
			width: 640,
			height: 360,
			mediaKind: 'silent-video',
			asset: {
				assetId: 'video-asset' as never,
				revisionId: 'video-revision-1' as never,
			},
			fit: 'contain',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}];

		const wrapper = await mountComponent();

		expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('false');
	});

	it('applies the same VP9 compatibility gate to a Graphic Group media child', async () => {
		const config = groupLayerConfig();
		const group = config.layout.items[0];
		if (group?.type !== 'graphic-group')
			throw new Error('Expected a Graphic Group fixture');
		group.children = [{
			id: 'restricted-group-video',
			type: 'media',
			label: 'Restricted group VP9 alpha',
			visible: true,
			layout: { mode: 'canvas', x: 0, y: 0, width: 640, height: 360 },
			asset: {
				assetId: 'group-video-asset' as never,
				revisionId: 'group-video-revision-1' as never,
			},
			mediaKind: 'silent-video',
			fit: 'contain',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}];
		mockConfig.value = config;

		const wrapper = await mountComponent();

		expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('false');
		expect(wrapper.find('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]').exists()).toBe(true);
	});
});
