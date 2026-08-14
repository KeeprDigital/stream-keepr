import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createFeatureMatchLayoutComposition, FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_SAMPLE_TOKEN_VALUES } from '~~/shared/featureMatchSampleDataset';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { GRAPHICS_PREVIEW_READY_MESSAGE } from '~/modules/graphics/previewMessages';

/**
 * Every Display a test mounts stays live otherwise, watching the same module-level
 * mocks. A test that edits configuration mid-flight is then observing every Display
 * the file has ever mounted rather than its own — which for the font tests means
 * counting one output's face registrations across two dozen of them.
 */
enableAutoUnmount(afterEach);

const mockConfig = ref<FeatureMatchOverlayModeConfig>(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
const mockOutputMode = ref<FeatureMatchOverlayOutput>('overlay');
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockScreen = ref({ screenConfig: { width: 1920, height: 1080 } });
const mockIsPreview = ref(false);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockContentUrlsSettled = ref(true);
/**
 * Whether the stubbed content-URL map is currently cleared.
 *
 * The real `useScreenGraphicAssetContentUrls` clears its whole map and goes unsettled
 * whenever the Screen's asset reference set changes — for any asset kind — and every
 * URL reads as the empty string until the capability session comes back. This stub
 * resolves synchronously instead, which is what keeps the tests around it about
 * typography rather than about capability plumbing, so a test that needs that window
 * drives it from here.
 */
const mockContentUrlsCleared = ref(false);

mockNuxtImport('useScreenContext', () => () => ({
	outputMode: mockOutputMode,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
	screen: mockScreen,
	isPreview: mockIsPreview,
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

/** Which pinned revisions this output's resolver has been told it will be refused. */
const mockRefusedRevisions = ref<string[]>([]);

mockNuxtImport('useScreenGraphicAssetContentUrls', () => () => ({
	contentUrl: (reference: { assetId: string; revisionId: string }) =>
		mockContentUrlsCleared.value ? '' : `/private-assets/${reference.assetId}/${reference.revisionId}`,
	contentRefusal: (reference: { revisionId: string }) =>
		mockRefusedRevisions.value.includes(reference.revisionId)
			? 'vp9-alpha-chromium-required'
			: undefined,
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

		/**
		 * The host-owned half of the pair below, which nothing pinned until #260: the
		 * frame's *send* of a Source Item selection had no test at all, so the type it
		 * goes out under was held at one end only. A sender and a receiver that source
		 * the same constant prove nothing about the wire between them unless both ends
		 * are read against the literal — which is why this asserts the literal.
		 */
		it('reports a Source Item click back to the editor in this host’s own vocabulary', async () => {
			mockConfig.value = guidedConfig();
			mockPreviewGuides.value = true;
			mockIsPreview.value = true;
			const postMessage = vi.spyOn(window.parent, 'postMessage');

			const wrapper = await mountComponent();
			await wrapper.get('[aria-label="Select Main Match Source"]').trigger('click');

			expect(postMessage).toHaveBeenCalledWith(
				{
					type: 'feature-match-overlay:select',
					target: { type: 'source', itemId: 'main-source' },
				},
				window.location.origin,
			);
			postMessage.mockRestore();
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
			// This is a frame an editor embedded, which is the only kind that listens
			// for either selection at all (#259).
			mockIsPreview.value = true;

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

		/**
		 * The host-owned selection travels on its own message beside the compositor's,
		 * in its own vocabulary — and through the same shared sender guard, rather than
		 * a hand-rolled copy of one beside a caller of the real thing (#252).
		 *
		 * Its type is spelled as the literal it goes on the wire as rather than as the
		 * constant both ends now read (#260): a test written in the constant moves with
		 * a rename and so cannot tell one from a no-op, while on the wire a rename ends
		 * the exchange in silence.
		 */
		it('marks the host-owned Source Item the editor selected, and only from the editor', async () => {
			mockConfig.value = guidedConfig();
			mockPreviewGuides.value = true;
			mockIsPreview.value = true;

			const wrapper = await mountComponent();
			const guide = () => wrapper.get('[aria-label="Select Main Match Source"]');
			expect(guide().classes()).not.toContain('is-selected');

			const target = { type: 'source', itemId: 'main-source' };
			// A window that did not embed this frame, then the embedding one speaking
			// from somewhere else.
			window.dispatchEvent(new MessageEvent('message', {
				origin: window.location.origin,
				source: { postMessage: vi.fn() } as unknown as MessageEventSource,
				data: { type: 'feature-match-overlay:selected-target', target },
			}));
			window.dispatchEvent(new MessageEvent('message', {
				origin: 'https://example.invalid',
				source: window.parent,
				data: { type: 'feature-match-overlay:selected-target', target },
			}));
			await nextTick();
			expect(guide().classes()).not.toContain('is-selected');

			window.dispatchEvent(new MessageEvent('message', {
				origin: window.location.origin,
				source: window.parent,
				data: { type: 'feature-match-overlay:selected-target', target },
			}));
			await nextTick();

			expect(guide().classes()).toContain('is-selected');
		});

		/**
		 * Who this frame is willing to hear a selection from (#259).
		 *
		 * Both listeners exist to hear the editor that embedded the frame, and the
		 * sender check they are built on compares `message.source` against
		 * `window.parent` — which on a live Screen Output is the output's own window,
		 * so it stops nothing there. A live output that installs the listeners
		 * anyway takes a selection from any same-origin script on the page.
		 *
		 * Pinned as "installs neither listener" rather than as "renders no guide",
		 * because the second is a fact about consumers this component does not own:
		 * the write is dead today only because the guide layer is gated on the guides
		 * flag and the render model passes `itemGuides: false` on a live output. A
		 * consumer that later reads `selectedPreviewTarget` unconditionally would
		 * reopen the hole without touching this file.
		 */
		describe('listening only where there is an editor to listen to', () => {
			async function mountCountingMessageListeners() {
				let installed = 0;
				const install = window.addEventListener.bind(window);
				const addEventListener = vi.spyOn(window, 'addEventListener')
					.mockImplementation((...args: Parameters<Window['addEventListener']>) => {
						if (args[0] === 'message')
							installed += 1;
						install(...args);
					});

				try {
					await mountComponent();
				}
				finally {
					addEventListener.mockRestore();
				}

				return installed;
			}

			it('installs no message listener at all on a live Screen Output', async () => {
				mockConfig.value = guidedConfig();

				expect(await mountCountingMessageListeners()).toBe(0);
			});

			it('installs both selection listeners in an embedded preview', async () => {
				// The other direction, so the pin above cannot be satisfied by a component
				// that listens to nobody.
				mockConfig.value = guidedConfig();
				mockIsPreview.value = true;

				expect(await mountCountingMessageListeners()).toBe(2);
			});

			/**
			 * The same rule read through what it protects, with the guides flag forced on
			 * beside a live output. The real screen context derives `previewGuides` from
			 * `isPreview`, so no URL produces this pair — which is exactly why it is
			 * driven from the mock here: it makes the gate's own behaviour observable
			 * instead of resting on a derivation two files away that could change.
			 */
			it('ignores a selection pushed at a live Screen Output, even with guides drawn', async () => {
				mockConfig.value = guidedConfig();
				mockPreviewGuides.value = true;

				const wrapper = await mountComponent();
				const sourceGuide = () => wrapper.get('[aria-label="Select Main Match Source"]');
				expect(sourceGuide().classes()).not.toContain('is-selected');

				window.dispatchEvent(new MessageEvent('message', {
					origin: window.location.origin,
					source: window.parent,
					data: { type: 'feature-match-overlay:selected-target', target: { type: 'source', itemId: 'main-source' } },
				}));
				window.dispatchEvent(new MessageEvent('message', {
					origin: window.location.origin,
					source: window.parent,
					data: {
						type: 'graphics-compositor:selected-target',
						target: { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: 'shared-clock' },
					},
				}));
				await nextTick();

				expect(sourceGuide().classes()).not.toContain('is-selected');
				expect(wrapper.get('[data-item-guide="shared-clock"]').classes()).not.toContain('is-selected');
			});
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
		mockContentUrlsCleared.value = false;
		mockUsesSampleDataset.value = false;
		mockRefusedRevisions.value = [];
		mockIsPreview.value = false;
	});

	/**
	 * The editor's only other moment to push its working configuration is the
	 * iframe's `load` event, which this client-rendered application fires before
	 * this frame's own app has mounted as often as after it. A push that lost that
	 * race was dropped silently and left the preview rendering the Screen's stored
	 * configuration (#235).
	 */
	describe('the editor preview handshake', () => {
		async function mountAnnouncing() {
			const announced: unknown[] = [];
			const parent = { postMessage: (message: unknown) => announced.push(message) };
			const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
			Object.defineProperty(window, 'parent', { configurable: true, value: parent });

			try {
				await mountComponent();
			}
			finally {
				if (originalParent)
					Object.defineProperty(window, 'parent', originalParent);
			}

			return announced;
		}

		it('tells the editor it is listening, as soon as it is', async () => {
			mockIsPreview.value = true;

			expect(await mountAnnouncing()).toEqual([{ type: GRAPHICS_PREVIEW_READY_MESSAGE }]);
		});

		it('announces nothing from a live Screen Output, which has no editor to answer', async () => {
			expect(await mountAnnouncing()).toEqual([]);
		});

		it('announces nothing when it is its own parent, having nobody to tell', async () => {
			// A preview URL opened in its own tab rather than embedded. `window.parent`
			// is then this window, and the announcement would be to itself.
			mockIsPreview.value = true;
			const announced: unknown[] = [];
			const originalPostMessage = window.postMessage;
			window.postMessage = ((message: unknown) => announced.push(message)) as typeof window.postMessage;

			try {
				await mountComponent();
			}
			finally {
				window.postMessage = originalPostMessage;
			}

			expect(announced).toEqual([]);
		});

		it('announces only once its own selection listeners are installed', async () => {
			// The announcement is the frame's promise that a full push will land, and
			// that push carries both selections as well as the configuration. Announcing
			// from the mode-data composable would make the promise one hook too early.
			mockIsPreview.value = true;
			mockPreviewGuides.value = true;
			const installed: string[] = [];
			const install = window.addEventListener.bind(window);
			const addEventListener = vi.spyOn(window, 'addEventListener')
				.mockImplementation((...args: Parameters<Window['addEventListener']>) => {
					if (args[0] === 'message')
						installed.push('listener');
					install(...args);
				});
			const parent = {
				postMessage: () => installed.push('ready'),
			};
			const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
			Object.defineProperty(window, 'parent', { configurable: true, value: parent });

			try {
				await mountComponent();
			}
			finally {
				if (originalParent)
					Object.defineProperty(window, 'parent', originalParent);
				addEventListener.mockRestore();
			}

			expect(installed.at(-1)).toBe('ready');
			// The two this component installs itself, either side of whatever the mode
			// data installs — the point is that none of them comes after the ready.
			expect(installed.filter(entry => entry === 'listener').length).toBeGreaterThanOrEqual(2);
		});
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

		it('marks restricted video output not ready outside a proven Chromium target, and says why on the output', async () => {
			// The content URL resolves — this Screen's capability session is no longer
			// refused Screen-wide for pinning one alpha clip (#98) — so the item reaches
			// its blocked branch rather than rendering an empty box for a missing `src`.
			mockConfig.value = videoComposition('chromium-transparency');

			const wrapper = await mountComponent();

			expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('false');
			const blocked = wrapper.get('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]');
			expect(blocked.text()).toContain('Chromium');
			expect(blocked.text()).toContain('vp9-alpha-chromium-required');
		});

		it('keeps the reason out of the Key Output, whose colour is the alpha matte', async () => {
			mockConfig.value = videoComposition('chromium-transparency');
			mockOutputMode.value = 'key';

			const wrapper = await mountComponent();

			expect(wrapper.get('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]').text()).toBe('');
		});

		it('says why for a clip the authoritative side refuses whatever the item recorded', async () => {
			// This host's own wiring of the reconciled compatibility (#184). The
			// mechanism is the shared compositor's, but a Feature Match Overlay passes
			// its resolver down itself, and a pass-through nobody checks is a
			// pass-through that can go missing — which here is silent, because the
			// blank rectangle it leaves is what the item drew before anyway.
			mockConfig.value = videoComposition('all-supported');
			mockRefusedRevisions.value = ['video-revision-1'];

			const wrapper = await mountComponent();

			expect(wrapper.find('video').exists()).toBe(false);
			expect(wrapper.get('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]').text())
				.toContain('vp9-alpha-chromium-required');
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
		/**
		 * A `FontFace` stub that records every family registered, with a gate a test can
		 * close so it can read the output while a load is in flight.
		 */
		function stubRecordingFontFace() {
			const registered: string[] = [];
			let hold = Promise.resolve();
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {
					registered.push(family);
				}

				async load() {
					await hold;
					return this;
				}
			});
			return {
				registered,
				/** Holds every load started from now until the returned release is called. */
				gate() {
					let release!: () => void;
					hold = new Promise<void>((resolve) => {
						release = resolve;
					});
					return () => release();
				},
			};
		}

		function layoutWithLibraryFont(
			{ revisionId = 'font-revision-2', backgroundColor, backgroundImage }: {
				revisionId?: string;
				backgroundColor?: string;
				backgroundImage?: { assetId: string; revisionId: string };
			} = {},
		): FeatureMatchOverlayModeConfig {
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
							reference: { assetId: 'font-asset', revisionId },
						},
					},
				}] as never,
			};
			if (backgroundColor !== undefined)
				config.layout.frame.backgroundColor = backgroundColor;
			if (backgroundImage)
				config.layout.frame.backgroundImage = backgroundImage as never;
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

		/**
		 * Hiding says "this font has not loaded yet", and it is only worth reading if
		 * that is the only thing it ever says. An operator editing the Frame's colour on
		 * a live overlay is editing something no font depends on, and blanking the
		 * canvas while a face that settled a minute ago re-registers is the visible
		 * blank the hiding exists to prevent (#160).
		 */
		it('keeps a settled output visible when a config edit names no different font', async () => {
			const { registered } = stubRecordingFontFace();

			const wrapper = await mountComponent();
			await vi.waitFor(() => {
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			});
			const settled = [...registered];
			expect(settled).toEqual(['stream-keepr-graphic-asset-font-asset-font-revision-2']);

			mockConfig.value = layoutWithLibraryFont({ backgroundColor: '#123456' });
			await nextTick();

			const overlay = wrapper.get('.feature-match-overlay');
			// The edit really landed, so this is not a test that changed nothing.
			expect(wrapper.get('.frame-layer > rect').attributes('fill')).toBe('#123456');
			// Read at the moment the edit renders, which is when the blank would be on air.
			expect(overlay.attributes('data-font-ready')).toBe('true');
			expect(overlay.attributes('data-export-ready')).toBe('true');
			expect((overlay.element as HTMLElement).style.visibility).toBe('');

			await flushPromises();
			await nextTick();

			expect(registered).toEqual(settled);
			expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
		});

		/**
		 * The other half of the same rule: an edit that really does change which faces
		 * the output paints has to load them, and has to hide until they are ready. A
		 * fix that simply stopped reloading would satisfy the test above and put a
		 * fallback typeface on air here.
		 */
		it('loads the new face and hides again when a config edit pins a different revision', async () => {
			const { registered, gate } = stubRecordingFontFace();

			const wrapper = await mountComponent();
			await vi.waitFor(() => {
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			});

			const release = gate();
			mockConfig.value = layoutWithLibraryFont({ revisionId: 'font-revision-3' });
			await nextTick();

			const hidden = wrapper.get('.feature-match-overlay');
			expect(hidden.attributes('data-font-ready')).toBe('false');
			expect((hidden.element as HTMLElement).style.visibility).toBe('hidden');

			release();
			await vi.waitFor(() => {
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			});
			expect(registered).toEqual([
				'stream-keepr-graphic-asset-font-asset-font-revision-2',
				'stream-keepr-graphic-asset-font-asset-font-revision-3',
			]);
			expect((wrapper.get('.feature-match-overlay').element as HTMLElement).style.visibility).toBe('');
			expect(wrapper.get('[data-graphic-item-kind="text"] p').attributes('style'))
				.toContain('font-family: stream-keepr-graphic-asset-font-asset-font-revision-3;');
		});

		/**
		 * This host's exposure to the same window (#160). An operator adding a Frame
		 * background image changes the Screen's asset reference set without touching a
		 * font reference, and the real `useScreenGraphicAssetContentUrls` responds by
		 * clearing its whole URL map and going unsettled until the capability session
		 * comes back. Every font URL reads empty for that round trip, and an output that
		 * took the blank URLs for a changed requirement would discard its faces and hide
		 * a settled overlay for the duration.
		 *
		 * The window is driven here rather than produced, because this suite stubs that
		 * resolution — the same stub that keeps its siblings about typography. That the
		 * window is real, and that the two legs arrive in this order, is proved against
		 * the unstubbed composable in the Broadcast Graphics suite; what this proves is
		 * that this host sits through it.
		 */
		it('keeps a settled output visible across the window an added Frame image opens', async () => {
			const { registered } = stubRecordingFontFace();

			const wrapper = await mountComponent();
			await vi.waitFor(() => {
				expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			});
			const settled = [...registered];
			expect(settled).toEqual(['stream-keepr-graphic-asset-font-asset-font-revision-2']);

			mockConfig.value = layoutWithLibraryFont({
				backgroundImage: { assetId: 'image-asset', revisionId: 'image-revision-1' },
			});
			mockContentUrlsCleared.value = true;
			mockContentUrlsSettled.value = false;
			await nextTick();

			const overlay = wrapper.get('.feature-match-overlay');
			// Read mid-window, which is when the blank would be on air.
			expect(overlay.attributes('data-font-ready')).toBe('true');
			expect((overlay.element as HTMLElement).style.visibility).toBe('');

			mockContentUrlsCleared.value = false;
			mockContentUrlsSettled.value = true;
			await nextTick();
			await flushPromises();
			await nextTick();

			// The image really landed, so this is not a test that changed nothing.
			expect(wrapper.get('.frame-layer image').html())
				.toContain('/private-assets/image-asset/image-revision-1');
			expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
			expect((wrapper.get('.feature-match-overlay').element as HTMLElement).style.visibility).toBe('');
			expect(registered).toEqual(settled);
		});
	});
});
