import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createFeatureMatchLayoutComposition, FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_SAMPLE_TOKEN_VALUES } from '~~/shared/featureMatchSampleDataset';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, getGraphicItemDefinition } from '~~/shared/modules/graphics';
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

const mockUsesSampleDataset = ref(false);

mockNuxtImport('useFeatureMatchOverlayModeData', () => () => ({
	config: computed(() => mockConfig.value),
	match: ref(null),
	matchState: ref(null),
	sourceMatch: ref(null),
	round: ref(null),
	phase: ref(null),
	event: ref(null),
	usesSampleDataset: computed(() => mockUsesSampleDataset.value),
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
			},
		},
	});
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
			// The composed tree is mounted above the Frame and the Source Items. A Fill
			// or Key Output's black backdrop painted here would
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

		it('feeds a composed context-gated Graphic Item from the host match state', async () => {
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

		it('reports a shared Graphic Item click back to the editor in the compositor’s vocabulary', async () => {
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
		mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		mockOutputMode.value = 'overlay';
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = { screenConfig: { width: 1920, height: 1080 } };
		mockLoading.value = false;
		mockError.value = null;
		mockContentUrlsSettled.value = true;
		mockUsesSampleDataset.value = false;
	});

	/**
	 * The canonical Feature Match sample dataset, and the one rule that keeps it
	 * safe: it is a preview affordance and never reaches air.
	 */
	describe('the canonical sample dataset', () => {
		function layoutBindingAToken(): FeatureMatchOverlayModeConfig {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			const nameplate = getGraphicItemDefinition('text').createDefault({
				id: 'nameplate',
				label: 'Nameplate',
				canvasWidth: 1920,
				canvasHeight: 1080,
			});
			if (nameplate.type !== 'text')
				throw new Error('expected a Text Graphic Item');
			nameplate.text = '{player1Name}';
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [nameplate],
			};
			config.layout.sources = [];
			return config;
		}

		/**
		 * A layout is authored long before the show it will run, so the Slot behind it
		 * is usually empty and every placeholder renders blank. An empty preview hides
		 * exactly what an author is judging: whether real values fit inside the bounds
		 * they drew.
		 */
		it('stands in for a Feature Match the preview does not have', async () => {
			mockConfig.value = layoutBindingAToken();
			mockUsesSampleDataset.value = true;

			const wrapper = await mountComponent();

			expect(wrapper.text()).toContain(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name);
		});

		/**
		 * The one failure sample data must never cause. A live Screen Output whose
		 * Feature Match Slot holds no Match renders empty; putting invented player
		 * names on air instead would be indistinguishable, to everyone watching, from
		 * real ones.
		 */
		it('never reaches a live Screen Output', async () => {
			mockConfig.value = layoutBindingAToken();
			mockUsesSampleDataset.value = false;

			const wrapper = await mountComponent();

			expect(wrapper.text()).not.toContain(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name);
		});
	});

	describe('the host-owned Source Items', () => {
		it('draws Source Items in their own back-to-front list order', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.sources = [
				{ ...config.layout.sources[0]!, id: 'back-source' },
				{ ...config.layout.sources[1]!, id: 'front-source' },
			];
			mockConfig.value = config;

			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-graphic-item-id]').map(item => item.attributes('data-graphic-item-id')))
				.toEqual(['back-source', 'front-source']);
		});

		it('omits a hidden Source Item entirely', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.sources = [{ ...config.layout.sources[0]!, id: 'hidden-source', visible: false }];
			mockConfig.value = config;

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-graphic-item-id="hidden-source"]').exists()).toBe(false);
		});
	});

	describe('exact Graphic Asset revisions', () => {
		function videoComposition(videoCompatibility: 'all-supported' | 'chromium-transparency') {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [{
					...getGraphicItemDefinition('media').createDefault({
						id: 'motion-ident',
						label: 'Motion ident',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
					mediaKind: 'silent-video',
					asset: {
						assetId: 'video-asset' as never,
						revisionId: 'video-revision-1' as never,
					},
					videoCompatibility,
				}] as never,
			};
			return config;
		}

		it('renders a silent-video Media Graphic Item from its exact revision content URL', async () => {
			mockConfig.value = videoComposition('all-supported');

			const wrapper = await mountComponent();

			expect(wrapper.get('video').attributes('src'))
				.toBe('/private-assets/video-asset/video-revision-1');
			expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('true');
		});

		it('marks restricted video output not ready outside a proven Chromium target', async () => {
			mockConfig.value = videoComposition('chromium-transparency');

			const wrapper = await mountComponent();

			expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('false');
			expect(wrapper.find('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]').exists()).toBe(true);
		});
	});

	/**
	 * The Feature Match Overlay's half of the library-font claim (#141).
	 *
	 * The capability-parity contract says #141 closed the font gap "for both hosts
	 * at once", and the mechanism really is shared — one discovery walk, one
	 * `useGraphicAssetFontFaces`. But a claim about two hosts that only one host
	 * proves is a claim resting on the wiring nobody checked, and this host is the
	 * one that *lost* the capability in the rewrite. So it is proved here too, in
	 * this host's own vocabulary: this Display owns its canvas element and its
	 * `data-export-ready`, which the shared compositor knows nothing about.
	 */
	describe('library fonts', () => {
		function layoutWithLibraryFont(): FeatureMatchOverlayModeConfig {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			const nameplate = getGraphicItemDefinition('text').createDefault({
				id: 'nameplate',
				label: 'Nameplate',
				canvasWidth: 1920,
				canvasHeight: 1080,
			});
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [{
					...nameplate,
					typography: {
						...DEFAULT_GRAPHIC_TYPOGRAPHY,
						font: {
							kind: 'asset',
							reference: { assetId: 'font-asset', revisionId: 'font-revision-2' },
						},
					},
				}] as never,
			};
			return config;
		}

		beforeEach(() => {
			mockConfig.value = layoutWithLibraryFont();
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

		it('paints text in the FontFace family the pinned revision resolves to', async () => {
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {}
				async load() { return this; }
			});

			const wrapper = await mountComponent();

			expect(wrapper.get('[data-graphic-item-kind="text"] p').attributes('style'))
				.toContain('font-family: stream-keepr-graphic-asset-font-asset-font-revision-2;');
		});

		it('loads the revision from its exact content URL and hides the output until it is ready', async () => {
			let finishLoad!: () => void;
			const loaded = new Promise<void>((resolve) => {
				finishLoad = resolve;
			});
			const sources: string[] = [];
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {
					sources.push(source);
				}

				async load() {
					await loaded;
					return this;
				}
			});

			const wrapper = await mountComponent();
			const overlay = wrapper.get('.feature-match-overlay');
			expect(overlay.attributes('data-font-ready')).toBe('false');
			expect(overlay.attributes('data-export-ready')).toBe('false');
			expect((overlay.element as HTMLElement).style.visibility).toBe('hidden');
			expect(sources).toEqual(['url("/private-assets/font-asset/font-revision-2")']);

			finishLoad();
			await vi.waitFor(() => {
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			});
			expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('true');
			expect((wrapper.get('.feature-match-overlay').element as HTMLElement).style.visibility).toBe('');
		});

		it('waits for private content URLs to resolve before loading anything', async () => {
			// A live output's URLs are not known until the capability session is
			// exchanged. Loading before then would ask for a URL that is still the empty
			// string, which is a failure rather than a wait.
			mockContentUrlsSettled.value = false;
			const load = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {}
				load = load;
			});

			const wrapper = await mountComponent();
			expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('false');
			expect(load).not.toHaveBeenCalled();

			mockContentUrlsSettled.value = true;
			await vi.waitFor(() => {
				expect(load).toHaveBeenCalled();
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			});
		});

		it('reports a font that cannot load rather than painting a fallback', async () => {
			// The failure is distinguishable from still-loading, and it withholds
			// export-readiness: an output that will never paint the authored typeface is
			// not a frame anyone should capture. It is never a fallback face — a Missing
			// Graphic Asset Reference is an integrity failure, and quietly painting
			// something else would hide it exactly when it matters.
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {}
				async load(): Promise<never> {
					throw new Error('font revision content is unavailable');
				}
			});

			const wrapper = await mountComponent();

			await vi.waitFor(() => {
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-error')).toBe('true');
			});
			const overlay = wrapper.get('.feature-match-overlay');
			expect(overlay.attributes('data-font-ready')).toBe('false');
			expect(overlay.attributes('data-export-ready')).toBe('false');
			expect((overlay.element as HTMLElement).style.visibility).toBe('hidden');
			// Every face this attempt added is taken back off the document, so a retry
			// does not accumulate a second registration of the same family.
			expect(document.fonts.delete as ReturnType<typeof vi.fn>).toHaveBeenCalled();
		});
	});
});
