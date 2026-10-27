import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createFeatureMatchLayoutComposition, FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_SAMPLE_TOKEN_VALUES } from '~~/shared/featureMatchSampleDataset';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import Display from '~/components/Screen/Modes/FeatureMatchOverlay/Display.vue';
import { GRAPHICS_PREVIEW_READY_MESSAGE } from '~/modules/graphics/previewMessages';

// Every Display a test mounts stays live otherwise, watching the same module-level mocks.
enableAutoUnmount(afterEach);

const mockConfig = ref<FeatureMatchOverlayModeConfig>(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
const mockOutputMode = ref<FeatureMatchOverlayOutput>('overlay');
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockEventCanvas = ref({ width: 1920, height: 1080 });
const mockIsPreview = ref(false);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockContentUrlsSettled = ref(true);
// Whether the stubbed content-URL map is currently cleared.
const mockContentUrlsCleared = ref(false);

mockNuxtImport('useScreenContext', () => () => ({
	outputMode: mockOutputMode,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
	eventCanvas: mockEventCanvas,
	isPreview: mockIsPreview,
}));

const mockUsesSampleDataset = ref(false);
const mockMatchState = ref<Record<string, unknown> | null>(null);
const mockEvent = ref<Record<string, unknown> | null>(null);

mockNuxtImport('useFeatureMatchOverlayModeData', () => () => ({
	config: computed(() => mockConfig.value),
	match: ref(null),
	matchState: mockMatchState,
	sourceMatch: ref(null),
	round: ref(null),
	phase: ref(null),
	event: mockEvent,
	usesSampleDataset: computed(() => mockUsesSampleDataset.value),
	loading: mockLoading,
	error: mockError,
}));

mockNuxtImport('useClockDisplay', () => () => ({
	displayTime: computed(() => '12:34'),
	showsClock: computed(() => true),
}));

/** The per-side deck data the host's own fetch path resolved; a stub here so these tests stay about composition, not fetching. */
const mockSideboards = ref<{ player1: Array<{ name: string; quantity: number; imageUrl: string | null }> | null; player2: Array<{ name: string; quantity: number; imageUrl: string | null }> | null }>({ player1: null, player2: null });

mockNuxtImport('useFeatureMatchOverlaySideboardData', () => () => ({
	sideboards: computed(() => mockSideboards.value),
	cardDataDegraded: ref(false),
}));

mockNuxtImport('useScreenGraphicAssetContentUrls', () => () => ({
	contentUrl: (reference: { assetId: string; revisionId: string }) =>
		mockContentUrlsCleared.value
			? ''
			: `/private-assets/${reference.assetId}/${reference.revisionId}`,
	contentUrlsSettled: mockContentUrlsSettled,
}));

async function mountComponent() {
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
				items: [
					getGraphicItemDefinition('clock').createDefault({
						id: 'clock',
						label: 'Clock',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
				],
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

		it('draws the Frame border and glow the render model resolves, in the Key Output too', async () => {
			// What the Frame paints is decided by the render model and tested there;
			// this pins only that the component draws what it is given.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame = {
				...config.layout.frame,
				borderVisible: true,
				borderColor: '#0077a3',
				borderWidth: 4,
				borderLeftVisible: false,
				glowSize: 12,
				glowOpacity: 0.5,
			};
			mockConfig.value = config;
			mockOutputMode.value = 'key';

			const wrapper = await mountComponent();
			const border = wrapper.get('.frame-layer g[stroke]');
			const filterId = border.attributes('filter')?.match(/^url\(#(.+)\)$/)?.[1];
			const shadow = wrapper.get(`filter[id="${filterId}"] feDropShadow`);

			expect(border.attributes('stroke')).toBe('#ffffff');
			expect(border.findAll('line')).toHaveLength(3);
			expect(shadow.attributes()).toMatchObject({ 'stdDeviation': '6', 'flood-color': '#ffffff', 'flood-opacity': '0.5' });
		});

		it('draws a Source Item glow in the Key Output too', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.sources = [
				{
					id: 'glowing',
					label: 'Glowing',
					visible: true,
					x: 100,
					y: 50,
					width: 400,
					height: 200,
					sourceRole: 'main',
					frameCutout: false,
					framingStyle: {
						borderVisible: true,
						borderColor: '#0077a3',
						borderWidth: 4,
						glowSize: 10,
						glowOpacity: 0.5,
					},
				},
			];
			mockConfig.value = config;
			mockOutputMode.value = 'key';

			const wrapper = await mountComponent();

			expect(wrapper.get('.feature-match-overlay__source-glow').attributes('style'))
				.toContain('drop-shadow(0 0 10px #ffffff80)');
		});

		it('never covers the host-owned layer with a backdrop of its own', async () => {
			// The composed tree is mounted above the Frame and the Source Items.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [
					getGraphicItemDefinition('clock').createDefault({
						id: 'clock',
						label: 'Clock',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
				],
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
				items: [
					getGraphicItemDefinition('clock').createDefault({
						id: 'clock',
						label: 'Clock',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
				],
			};
			mockConfig.value = config;

			const wrapper = await mountComponent();

			// The clock string comes from the host, so the composed item renders it
			// without any Graphic Text Template having been authored.
			expect(wrapper.get('[data-graphic-item-kind="clock"]').text()).toBe('12:34');
		});

		it('draws preset Game Wins Items from the Event Match Format and reconfigures their display', async () => {
			mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			mockUsesSampleDataset.value = true;
			mockEvent.value = { featureMatchDefaultBestOf: 5 };

			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-graphic-item-kind="game-wins"]')).toHaveLength(2);
			expect(wrapper.findAll('[data-game-win="won"]')).toHaveLength(2);
			// Best-of-five takes three wins, so each sampled player has one won box
			// and two pending boxes.
			expect(wrapper.findAll('[data-game-win="pending"]')).toHaveLength(4);
			expect((wrapper.get('[data-game-win="won"]').element as HTMLElement).style.width).toBe('22px');
			expect((wrapper.get('[data-game-win="won"]').element as HTMLElement).style.height).toBe('22px');

			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			for (const item of config.layout.composition.items) {
				if (item.type === 'game-wins')
					item.displayMode = 'number';
			}
			mockConfig.value = config;
			await nextTick();

			const scores = wrapper.findAll('[data-graphic-item-kind="game-wins"]');
			expect(scores.map(score => score.text())).toEqual(['1', '1']);
			expect(wrapper.find('[data-game-win]').exists()).toBe(false);
		});

		it('feeds a Deck List Graphic Item from the host-resolved sideboard data (#491)', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [
					Object.assign(getGraphicItemDefinition('deck-list').createDefault({
						id: 'deck',
						label: 'Deck',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}), { view: 'grid' as const }),
				],
			};
			mockConfig.value = config;
			mockMatchState.value = {
				player1: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
				player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
			};
			mockSideboards.value = {
				player1: [
					{ name: 'Duress', quantity: 2, imageUrl: null },
				],
				player2: null,
			};

			const wrapper = await mountComponent();

			// The card the host's deck data path resolved reaches the composed item.
			expect(wrapper.find('[data-deck-card="Duress"]').exists()).toBe(true);
		});

		it('plays a hidden Deck List"s authored exit before the renders-nothing state (#492)', async () => {
			// The sideboardRevealed true→false edge: the host keeps the cards
			// rendering while the item's own exit recipe plays, then hands it to the
			// flag's renders-nothing state. The item is on air throughout (ADR 0015).
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [
					Object.assign(getGraphicItemDefinition('deck-list').createDefault({
						id: 'deck',
						label: 'Deck',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}), {
						view: 'grid' as const,
						animation: {
							exit: {
								duration: 30,
								easing: 'linear' as const,
								delay: 0,
								fade: { opacity: 0 },
							},
						},
					}),
				],
			};
			mockConfig.value = config;
			mockMatchState.value = {
				player1: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
				player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
			};
			mockSideboards.value = {
				player1: [
					{ name: 'Duress', quantity: 2, imageUrl: null },
				],
				player2: null,
			};

			const wrapper = await mountComponent();
			expect(wrapper.find('[data-deck-card="Duress"]').exists()).toBe(true);

			mockMatchState.value = {
				player1: { lifeTotal: 20, gameWins: 0, sideboardRevealed: false },
				player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
			};
			await nextTick();

			// Still rendering: the exit is in play, not cut.
			expect(wrapper.find('[data-deck-card="Duress"]').exists()).toBe(true);

			// The recipe's end passes on the output's own animation-frame clock, the
			// settled trigger drops, and the flag alone decides again.
			await vi.waitFor(() => {
				expect(wrapper.find('[data-deck-card="Duress"]').exists()).toBe(false);
			}, { timeout: 2000 });
		});
	});

	// ADR-0051: the overlay composes in the Event Canvas.
	it('draws the Frame across the Event Canvas', async () => {
		mockEventCanvas.value = { width: 1280, height: 720 };

		const wrapper = await mountComponent();

		expect(wrapper.get('svg.frame-layer').attributes('viewBox')).toBe('0 0 1280 720');
	});

	describe('the editor preview guide layer', () => {
		function guidedConfig(): FeatureMatchOverlayModeConfig {
			// A layout with both authoring surfaces populated: the Source Items the
			// default preset carries, and one shared Graphic Item in the composition.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [
					getGraphicItemDefinition('clock').createDefault({
						id: 'shared-clock',
						label: 'Shared Clock',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
				],
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

		// The host-owned half of the pair below, which nothing pinned until #260: the frame's
		// *send* of a Source Item selection had no test at all, so the type it goes out under was…
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

		// The host-owned selection travels on its own message beside the compositor's, in its own
		// vocabulary — and through the same shared sender guard, rather than a hand-rolled copy of…
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
				source: {
					postMessage: vi.fn(),
				} as unknown as MessageEventSource,
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

		// Who this frame is willing to hear a selection from (#259).
		describe('listening only where there is an editor to listen to', () => {
			// The same rule read through what it protects, with the guides flag forced on beside a
			// live output.
			it('ignores a selection pushed at a live Screen Output, even with guides drawn', async () => {
				mockConfig.value = guidedConfig();
				mockPreviewGuides.value = true;

				const wrapper = await mountComponent();
				const sourceGuide = () => wrapper.get('[aria-label="Select Main Match Source"]');
				expect(sourceGuide().classes()).not.toContain('is-selected');

				window.dispatchEvent(new MessageEvent('message', {
					origin: window.location.origin,
					source: window.parent,
					data: {
						type: 'feature-match-overlay:selected-target',
						target: { type: 'source', itemId: 'main-source' },
					},
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
		mockEventCanvas.value = { width: 1920, height: 1080 };
		mockLoading.value = false;
		mockError.value = null;
		mockContentUrlsSettled.value = true;
		mockContentUrlsCleared.value = false;
		mockUsesSampleDataset.value = false;
		mockIsPreview.value = false;
		mockMatchState.value = null;
		mockEvent.value = null;
		mockSideboards.value = { player1: null, player2: null };
	});

	// The editor's only other moment to push its working configuration is the iframe's `load`
	// event, which this client-rendered application fires before this frame's own app has mounted…
	describe('the editor preview handshake', () => {
		async function mountAnnouncing() {
			const announced: unknown[] = [];
			const parent = {
				postMessage: (message: unknown) => announced.push(message),
			};
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

			expect(await mountAnnouncing()).toEqual([
				{ type: GRAPHICS_PREVIEW_READY_MESSAGE },
			]);
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

		// A layout is authored long before the show it will run, so the Slot behind it is usually
		// empty and every placeholder renders blank.
		it('stands in for a Feature Match the preview does not have', async () => {
			mockConfig.value = layoutBindingAToken();
			mockUsesSampleDataset.value = true;

			const wrapper = await mountComponent();

			expect(wrapper.text()).toContain(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name);
		});

		// The one failure sample data must never cause.
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
			config.layout.sources = [
				{ ...config.layout.sources[0]!, id: 'hidden-source', visible: false },
			];
			mockConfig.value = config;

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-graphic-item-id="hidden-source"]').exists()).toBe(false);
		});
	});

	describe('exact Graphic Asset revisions', () => {
		/**
		 * A silent-video composition. The item may carry the `videoCompatibility` a
		 * layout recorded before ADR-0020; it changes nothing.
		 */
		function videoComposition(videoCompatibility?: 'all-supported' | 'chromium-transparency') {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [
					{
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
						...(videoCompatibility
							? { videoCompatibility }
							: {}),
					},
				] as never,
			};
			return config;
		}

		it('renders a silent-video Media Graphic Item from its exact revision content URL', async () => {
			mockConfig.value = videoComposition();

			const wrapper = await mountComponent();

			expect(wrapper.get('video').attributes('src'))
				.toBe('/private-assets/video-asset/video-revision-1');
			expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('true');
		});

		it('plays and stays export-ready for a transparent video recorded before ADR-0020, whatever the browser', async () => {
			// Chromium is the only supported engine for transparent video, so a layout
			// that still records a Chromium-only clip is rendered and ready like any other.
			mockConfig.value = videoComposition('chromium-transparency');

			const wrapper = await mountComponent();

			expect(wrapper.get('video').attributes('src'))
				.toBe('/private-assets/video-asset/video-revision-1');
			expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('true');
		});
	});

	// The Feature Match Overlay's half of the library-font claim (#141).
	// The Frame's image and video each take a Screen Media Source (ADR-0021): a library revision
	// resolves through the Screen's content URLs, a Remote Media URL is drawn as given.
	describe('the Frame’s own media', () => {
		const loopVideo = {
			enabled: true,
			fit: 'contain' as const,
			opacity: 0.6,
			playbackRate: 2,
			loop: false,
		};

		function frameWith(frame: Partial<FeatureMatchOverlayModeConfig['layout']['frame']>) {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame = {
				...config.layout.frame,
				...frame,
			};
			return config;
		}

		async function frameVideo() {
			const wrapper = await mountComponent();
			return wrapper.findComponent({ name: 'FeatureMatchOverlayFrameMedia' }).props('video');
		}

		it('draws a library-sourced Frame image from its exact revision content URL', async () => {
			mockConfig.value = frameWith({
				backgroundImage: { kind: 'asset', assetId: 'plate' as never, revisionId: 'plate-1' as never },
			});

			const wrapper = await mountComponent();

			expect(wrapper.get('.frame-layer image').html()).toContain('/private-assets/plate/plate-1');
		});

		it('draws a Remote Media URL Frame image as given', async () => {
			mockConfig.value = frameWith({
				backgroundImage: { kind: 'url', url: 'https://cdn.example.com/plate.png' },
			});

			const wrapper = await mountComponent();

			expect(wrapper.get('.frame-layer image').html()).toContain('https://cdn.example.com/plate.png');
		});

		it('plays a library-sourced Frame video from its exact revision content URL', async () => {
			mockConfig.value = frameWith({
				mediaBackground: {
					...loopVideo,
					source: { kind: 'asset', assetId: 'loop' as never, revisionId: 'loop-2' as never },
				},
			});

			expect(await frameVideo()).toEqual({
				url: '/private-assets/loop/loop-2',
				fit: 'contain',
				opacity: 0.6,
				playbackRate: 2,
				loop: false,
			});
		});

		it('plays a Remote Media URL Frame video as given', async () => {
			mockConfig.value = frameWith({
				mediaBackground: {
					...loopVideo,
					source: { kind: 'url', url: '/video/loop.mp4' },
				},
			});

			expect(await frameVideo()).toMatchObject({ url: '/video/loop.mp4' });
		});

		it('plays nothing for a disabled Frame video', async () => {
			mockConfig.value = frameWith({
				mediaBackground: {
					...loopVideo,
					enabled: false,
					source: { kind: 'url', url: '/video/loop.mp4' },
				},
			});

			expect(await frameVideo()).toBeUndefined();
		});
	});

	// Loading, superseding and the #160 settled-output rules are `useGraphicAssetFontFaces`' own test.
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
				items: [
					{
						...nameplate,
						typography: {
							...DEFAULT_GRAPHIC_TYPOGRAPHY,
							font: {
								kind: 'asset',
								reference: { assetId: 'font-asset', revisionId: 'font-revision-2' },
							},
						},
					},
				] as never,
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

		it('reports a font that cannot load without leaving the entire output blank', async () => {
			// Withheld from export, but revealed: the Frame, Sources and other Items still paint.
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
			expect((overlay.element as HTMLElement).style.visibility).toBe('');
			expect(wrapper.get('[data-graphic-item-kind="text"]').text()).toContain('Text');
		});
	});
});
