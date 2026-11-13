import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createFeatureMatchLayoutComposition, FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_SAMPLE_TOKEN_VALUES, featureMatchSampleDataset } from '~~/shared/featureMatchSampleDataset';
import { featureMatchStressDataset } from '~~/shared/featureMatchStressDataset';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { applicationGraphicFont } from '~~/shared/types/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { deferred } from '~~/test/helpers/deferred';
import { withLayersLocked } from '~~/test/helpers/featureMatchLayoutDocument';
import { clock, shape, text } from '~~/test/helpers/graphicsComposition';
import { LUFFY } from '~~/test/helpers/opCards';
import { stubDocumentFonts } from '~~/test/nuxt/helpers/fontFaces';
import Display from '~/components/Screen/Modes/FeatureMatchOverlay/Display.vue';
import { GRAPHICS_PREVIEW_ANIMATION_MESSAGE, GRAPHICS_PREVIEW_READY_MESSAGE } from '~/modules/graphics/previewMessages';

// Every Display a test mounts stays live otherwise, watching the same module-level mocks.
enableAutoUnmount(afterEach);

const mockConfig = ref<FeatureMatchOverlayModeConfig>(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
const mockOutputMode = ref<FeatureMatchOverlayOutput>('overlay');
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockPreviewStressDataset = ref(false);
const mockEventCanvas = ref({ width: 1920, height: 1080 });
const mockIsPreview = ref(false);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockContentUrlsSettled = ref(true);
// Whether the stubbed content-URL map is currently cleared.
const mockContentUrlsCleared = ref(false);
/** The Event's Theme, and the Screen's own overrides of it. */
const mockTheme = ref<StoredThemeTokens>();
const mockScreen = ref<{ themeOverrides: StoredThemeTokens }>({ themeOverrides: {} });
/** A Theme preview's Card Game; an Event's preview leaves it unset. */
let mockSampleDataset: 'mtg' | 'op' | undefined;

mockNuxtImport('useScreenContext', () => () => ({
	outputMode: mockOutputMode,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
	previewStressDataset: mockPreviewStressDataset,
	eventCanvas: mockEventCanvas,
	isPreview: mockIsPreview,
	themeTokens: mockTheme,
	screen: mockScreen,
	sampleDataset: mockSampleDataset,
}));

afterEach(() => {
	mockSampleDataset = undefined;
	mockTheme.value = undefined;
	mockScreen.value = { themeOverrides: {} };
});

const mockUsesSampleDataset = ref(false);
const mockMatchState = ref<Record<string, unknown> | null>(null);
const mockEvent = ref<Record<string, unknown> | null>(null);
const mockMatch = ref<Record<string, unknown> | null>(null);

mockNuxtImport('useFeatureMatchOverlayModeData', () => () => ({
	config: computed(() => mockConfig.value),
	match: mockMatch,
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

		it('draws the Frame border and glow its Screen\'s surface override resolves, in the Key Output too', async () => {
			// What the Frame paints is decided by the render model and tested there;
			// this pins only that the component draws what the Screen's tokens give it.
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame = { ...config.layout.frame, borderLeftVisible: false };
			mockConfig.value = config;
			mockScreen.value = {
				themeOverrides: {
					'feature-match-overlay.frame-surface': {
						fill: { type: 'solid', color: '#111111' },
						fillOpacity: 1,
						outline: { color: '#0077a3', width: 4 },
						glow: { color: '#0077a3', size: 12, opacity: 0.5 },
					},
				},
			};
			mockOutputMode.value = 'key';

			const wrapper = await mountComponent();
			const border = wrapper.get('.feature-match-overlay__frame-border');
			const filterId = border.attributes('filter')?.match(/^url\(#(.+)\)$/)?.[1];
			const shadow = wrapper.get(`filter[id="${filterId}"] feDropShadow`);

			expect(border.attributes('stroke')).toBe('#ffffff');
			expect(border.findAll('line')).toHaveLength(3);
			expect(shadow.attributes()).toMatchObject({ 'stdDeviation': '6', 'flood-color': '#ffffff', 'flood-opacity': '0.5' });
		});

		it('draws a Source Item glow its Screen\'s surface override resolves, in the Key Output too', async () => {
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
				},
			];
			mockConfig.value = config;
			mockScreen.value = {
				themeOverrides: {
					'feature-match-overlay.source-surface': {
						fill: { type: 'solid', color: '#000000' },
						fillOpacity: 0,
						outline: { color: '#0077a3', width: 4 },
						glow: { color: '#0077a3', size: 10, opacity: 0.5 },
					},
				},
			};
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
			});
		});
	});

	// A Session arriving or leaving is this output joining a value, not an operator's
	// reveal or hide: it cuts to the settled frame and plays no authored motion.
	describe('a Feature Match Session arriving or leaving', () => {
		const revealedSession = {
			player1: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
			player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: true },
		};
		const SLOW = {
			duration: 60_000,
			easing: 'linear' as const,
			delay: 0,
			fade: { opacity: 0 },
		};

		beforeEach(() => {
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
						animation: { enter: SLOW, exit: SLOW },
					}),
				],
			};
			mockConfig.value = config;
			mockSideboards.value = {
				player1: [
					{ name: 'Duress', quantity: 2, imageUrl: null },
				],
				player2: null,
			};
		});

		it('shows a Sideboard already revealed at once, without its enter', async () => {
			mockMatchState.value = null;
			const wrapper = await mountComponent();

			mockMatchState.value = revealedSession;
			await nextTick();

			// The enter fades in from nothing, so its first frame would be transparent.
			const deckList = wrapper.get('[data-graphic-item-kind="deck-list"]');
			expect(deckList.find('[data-deck-card="Duress"]').exists()).toBe(true);
			expect(deckList.attributes('style')).not.toContain('opacity: 0');
		});

		it('drops a revealed Sideboard at once, without its exit', async () => {
			mockMatchState.value = revealedSession;
			const wrapper = await mountComponent();

			mockMatchState.value = null;
			await nextTick();

			expect(wrapper.find('[data-deck-card="Duress"]').exists()).toBe(false);
		});
	});

	// A One Piece deck is named by its Leader, which also sets its colours (ADR-0057).
	it('shows a One Piece side\'s Leader where a Magic deck name and its colours would be', async () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.composition = {
			...createFeatureMatchLayoutComposition(),
			items: [
				{
					...getGraphicItemDefinition('text').createDefault({
						id: 'leader',
						label: 'Leader',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
					text: '{player1LeaderImage}{player1DeckColors} {player1Deck}',
				} as never,
			],
		};
		mockConfig.value = config;
		mockEvent.value = { name: 'One Piece Regional', game: 'op' };
		mockMatch.value = {
			id: 1,
			player1Data: {
				name: 'Ana',
				gameData: {
					type: 'op',
					leader: LUFFY,
				},
			},
			player2Data: null,
			activeSession: null,
		};

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-op-card-image]').attributes('src')).toBe(LUFFY.imageUrl);
		expect(wrapper.get('[data-op-colors]').attributes('aria-label')).toBe('Red/Green');
		expect(wrapper.get('[data-graphic-item-kind="text"]').text()).toContain('Monkey.D.Luffy');
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

		// #740: the editor decides what a toggle leaves selected, and pushes the marks back down.
		it.each([
			[
				'a ⌘-click on a Source Item',
				'[aria-label="Select Main Match Source"]',
				{ metaKey: true },
				'feature-match-overlay:select',
				{ type: 'source', itemId: 'main-source' },
			],
			[
				'a Ctrl-click on a Graphic Item',
				'[data-item-guide="shared-clock"]',
				{ ctrlKey: true },
				'graphics-compositor:select',
				{ type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: 'shared-clock' },
			],
		])('reports %s as a toggle, marking nothing itself', async (_, guide, modifiers, type, target) => {
			mockConfig.value = guidedConfig();
			mockPreviewGuides.value = true;
			mockIsPreview.value = true;
			const postMessage = vi.spyOn(window.parent, 'postMessage');

			const wrapper = await mountComponent();
			await wrapper.get(guide).trigger('click', modifiers);

			expect(postMessage).toHaveBeenCalledWith({ type, target, toggle: true }, window.location.origin);
			expect(wrapper.findAll('.is-selected')).toHaveLength(0);
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

		// A click on a layer the layout stores locked falls through to whatever lies beneath it.
		it('stops offering the layers the layout locks, so a click reaches what lies beneath', async () => {
			const config = guidedConfig();
			mockConfig.value = {
				...config,
				layout: withLayersLocked(config.layout, ['main-source', 'shared-clock']),
			};
			mockPreviewGuides.value = true;
			mockIsPreview.value = true;
			const postMessage = vi.spyOn(window.parent, 'postMessage');

			const wrapper = await mountComponent();
			await nextTick();

			expect(wrapper.find('[aria-label="Select Main Match Source"]').exists()).toBe(false);
			expect(wrapper.find('[aria-label="Select Shared Clock"]').exists()).toBe(false);
			expect(wrapper.find('[aria-label="Select Player 1 Source"]').exists()).toBe(true);
			const locked = wrapper.findAll('[data-locked="true"]');
			expect(locked).toHaveLength(2);
			for (const guide of locked)
				await guide.trigger('click');
			expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
				target: expect.objectContaining({
					itemId: expect.any(String),
				}),
			}), expect.anything());
			postMessage.mockRestore();
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
		mockMatch.value = null;
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
		afterEach(() => {
			mockEvent.value = null;
		});

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

		// The sample is the Card Game's the preview is of: an Event's, or a Theme preview's own.
		it.each([
			{
				game: 'mtg',
				event: { game: 'mtg' },
				sampleDataset: undefined,
			},
			{
				game: 'op',
				event: { game: 'op' },
				sampleDataset: undefined,
			},
			{ game: 'op', event: null, sampleDataset: 'op' },
			{
				game: 'mtg',
				event: { game: 'op' },
				sampleDataset: 'mtg',
			},
		] as const)('stands in the $game sample for event $event.game and Theme preview $sampleDataset', async ({ game, event, sampleDataset }) => {
			const config = layoutBindingAToken();
			const nameplate = config.layout.composition.items[0]!;
			if (nameplate.type === 'text')
				nameplate.text = '{player1Name} {player1Deck}';
			mockConfig.value = config;
			mockUsesSampleDataset.value = true;
			mockEvent.value = event;
			mockSampleDataset = sampleDataset;

			const wrapper = await mountComponent();

			const { player1Name, player1Deck } = featureMatchSampleDataset(game).tokenValues;
			expect(wrapper.text()).toContain(`${player1Name} ${player1Deck}`);
		});

		// The one failure sample data must never cause.
		it('never reaches a live Screen Output', async () => {
			mockConfig.value = layoutBindingAToken();
			mockUsesSampleDataset.value = false;

			const wrapper = await mountComponent();

			expect(wrapper.text()).not.toContain(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name);
		});
	});

	/**
	 * The editor's stress toggle resolves the layout against the Feature Match
	 * Stress Dataset, over a bound Slot's live data too.
	 */
	describe('the Feature Match Stress Dataset', () => {
		afterEach(() => {
			mockPreviewStressDataset.value = false;
			mockUsesSampleDataset.value = false;
			mockEvent.value = null;
			mockMatch.value = null;
			mockMatchState.value = null;
		});

		function layoutShowing(nameplate: string): FeatureMatchOverlayModeConfig {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: [
					text('nameplate', { text: nameplate, width: 1600 }),
					clock('clock'),
				],
			};
			config.layout.sources = [];
			return config;
		}

		const LIVE_MATCH = {
			id: 9,
			player1Data: { name: 'Live Player' },
			player2Data: { name: 'Live Opponent' },
		};

		it.each([
			{
				over: 'the sample',
				usesSample: true,
				match: null,
				game: 'mtg',
			},
			{
				over: 'a bound Slot',
				usesSample: false,
				match: LIVE_MATCH,
				game: 'mtg',
			},
			{
				over: 'a bound Slot',
				usesSample: false,
				match: LIVE_MATCH,
				game: 'op',
			},
		] as const)('shows the $game values over $over while the toggle is on, and not once it is off', async ({ usesSample, match, game }) => {
			mockConfig.value = layoutShowing('{player1Name} {player1Deck}');
			mockUsesSampleDataset.value = usesSample;
			mockMatch.value = match;
			mockEvent.value = { game };
			mockPreviewStressDataset.value = true;

			const wrapper = await mountComponent();
			const { player1Name, player1Deck } = featureMatchStressDataset(game, { untimed: false }).tokenValues;

			expect(wrapper.text()).toContain(`${player1Name} ${player1Deck}`);
			expect(wrapper.get('[data-graphic-item-kind="clock"]').text()).toBe('1:23:45');

			mockPreviewStressDataset.value = false;
			await nextTick();

			expect(wrapper.text()).not.toContain(String(player1Name));
		});

		// An Untimed Match shows its Untimed Label where the clock would be.
		it.each([
			{
				untimedBy: 'the active Session',
				matchState: {
					clock: { type: 'untimed' },
				},
				event: { game: 'mtg' },
			},
			{
				untimedBy: 'the Event\'s Match Format',
				matchState: null,
				event: { game: 'mtg', featureMatchDefaultClockType: 'untimed' },
			},
		])('shows the longest Untimed Label for a Match untimed by $untimedBy', async ({ matchState, event }) => {
			mockConfig.value = layoutShowing('{player1Name}');
			mockUsesSampleDataset.value = matchState === null;
			mockMatch.value = matchState ? LIVE_MATCH : null;
			mockMatchState.value = matchState;
			mockEvent.value = event;
			mockPreviewStressDataset.value = true;

			const wrapper = await mountComponent();

			expect(wrapper.get('[data-graphic-item-kind="clock"]').text())
				.toBe(featureMatchStressDataset('mtg', { untimed: true }).context.clockDisplayTime);
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
	// A placed preset follows its Theme on every output: the Frame and Source Items
	// through the overlay's Mode Tokens, its Graphic Items through their bindings (#831).
	describe('the Theme a placed preset renders under', () => {
		function frameStroke(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.get('.feature-match-overlay__frame-border').attributes('stroke');
		}
		function sourceBorder(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return (wrapper.get('[data-graphic-item-id="main-source"]').element as HTMLElement).style.borderTop;
		}
		function panelFill(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.get('[data-graphic-item-kind="shape"] path').attributes('fill');
		}

		beforeEach(() => {
			mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		});

		it.each([
			{
				output: 'overlay',
				stroke: '#c0ffee',
				border: '4px solid #c0ffee',
				panel: '#c0ffee',
			},
			{
				output: 'fill',
				stroke: '#c0ffee',
				border: '4px solid #c0ffee',
				panel: '#c0ffee',
			},
			{
				output: 'key',
				stroke: '#ffffff',
				border: '4px solid #ffffff',
				panel: '#ffffff',
			},
		] as const)('restyles its Frame, Source Items and panels live when the Theme\'s accent changes, in the $output Output', async ({ output, stroke, border, panel }) => {
			mockOutputMode.value = output;
			mockTheme.value = { accent: '#123456' };
			const wrapper = await mountComponent();

			mockTheme.value = { accent: '#c0ffee' };
			await nextTick();

			expect(frameStroke(wrapper)).toBe(stroke);
			expect(sourceBorder(wrapper)).toBe(border);
			expect(panelFill(wrapper)).toBe(panel);
		});

		// A Screen takes the accent from its Theme alone; an override stored before is read by nothing.
		it('restyles them from its Theme\'s accent, never a stored override of it', async () => {
			mockTheme.value = { accent: '#123456' };
			mockScreen.value = {
				themeOverrides: { accent: '#654321' },
			};

			const wrapper = await mountComponent();

			expect(frameStroke(wrapper)).toBe('#123456');
			expect(panelFill(wrapper)).toBe('#123456');
		});

		// The override is in the form stored before writes were literal-only: its colour names the Theme's accent.
		it('fills the Frame from the Screen\'s Frame surface override', async () => {
			mockTheme.value = { accent: '#abcdef' };
			mockScreen.value = {
				themeOverrides: {
					'feature-match-overlay.frame-surface': {
						fill: {
							type: 'solid',
							color: { token: 'accent' },
						},
						fillOpacity: 0.5,
					},
				},
			};

			const fill = (await mountComponent()).get('.feature-match-overlay__frame-fill');

			expect(fill.attributes()).toMatchObject({ 'fill': '#abcdef', 'fill-opacity': '0.5' });
		});

		it('draws its Event Branding from the Theme\'s logo, resolved through its exact revision', async () => {
			mockTheme.value = {
				logo: { kind: 'image', assetId: 'logo-asset', revisionId: 'logo-revision' },
			};

			const wrapper = await mountComponent();

			expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('src'))
				.toBe('/private-assets/logo-asset/logo-revision');
		});

		it('draws the Screen\'s Frame media beneath the Frame\'s own', async () => {
			mockScreen.value = {
				themeOverrides: {
					'feature-match-overlay.frame-media': { kind: 'image', assetId: 'backdrop', revisionId: 'backdrop-1' },
				},
			};

			const image = (await mountComponent()).get('.feature-match-overlay__theme-frame-image');

			expect(image.attributes('href') ?? image.attributes('xlink:href')).toBe('/private-assets/backdrop/backdrop-1');
		});

		it('draws the Frame\'s Animation Effect the Theme names', async () => {
			mockTheme.value = {
				'animation-effect': { effect: 'net' },
			};

			const frame = (await mountComponent()).get('.frame-layer');

			expect(frame.attributes('data-frame-animation-effect')).toBe('net');
		});

		it('loads a library font the Theme\'s heading supplies to a bound Graphic Item', async () => {
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
			const sources: string[] = [];
			vi.stubGlobal('FontFace', class {
				constructor(public family: string, public source: string) {
					sources.push(source);
				}

				async load() { return this; }
			});
			mockTheme.value = {
				heading: {
					font: {
						kind: 'asset',
						reference: { assetId: 'heading-font', revisionId: 'heading-font-1' },
					},
					weight: 800,
					lineHeight: 1,
					tracking: 0,
					case: 'none',
				},
			};

			const wrapper = await mountComponent();

			await vi.waitFor(() => expect(sources).toContain('url("/private-assets/heading-font/heading-font-1")'));
			expect(wrapper.get('[data-graphic-item-kind="text"] p').attributes('style'))
				.toContain('font-family: stream-keepr-graphic-asset-heading-font-heading-font-1;');
		});
	});

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

	// An application font ships as CSS `@font-face`, which swaps in late on a cold cache; readiness waits for it.
	it('reports its fonts unready until the application face its Graphic Items paint has loaded', async () => {
		const load = deferred<unknown>();
		const fonts = stubDocumentFonts(async () => load.promise);
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.composition = {
			...createFeatureMatchLayoutComposition(),
			items: [
				text('nameplate', {
					typography: {
						...DEFAULT_GRAPHIC_TYPOGRAPHY,
						font: applicationGraphicFont('poppins'),
					},
				}),
			],
		};
		mockConfig.value = config;

		const wrapper = await mountComponent();
		expect(fonts.load).toHaveBeenCalledWith(`normal ${DEFAULT_GRAPHIC_TYPOGRAPHY.fontWeight} 1em "Poppins"`);
		expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('false');

		load.resolve([{}]);
		await vi.waitFor(() => {
			expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
		});
	});

	// An editor-only run over the working layout; a live output never plays one.
	describe('the graphic animation preview', () => {
		const fadeIn = {
			enter: {
				duration: 4000,
				easing: 'linear' as const,
				delay: 0,
				fade: { opacity: 0 },
			},
		};

		function animatedConfig(): FeatureMatchOverlayModeConfig {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.composition = {
				...createFeatureMatchLayoutComposition(),
				items: ['bar', 'badge'].map(id => shape(id, { animation: fadeIn })),
			};
			config.layout.frame = {
				...config.layout.frame,
				animation: { enabled: true, opacity: 0.6 },
			};
			return config;
		}

		function pushRun(plan: Record<string, unknown> | null) {
			window.dispatchEvent(new MessageEvent('message', {
				origin: window.location.origin,
				source: window.parent,
				data: {
					type: GRAPHICS_PREVIEW_ANIMATION_MESSAGE,
					plan: plan && {
						graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
						scope: 'phase',
						phase: 'enter',
						run: 1,
						speed: 1,
						loop: false,
						...plan,
					},
				},
			}));
			return nextTick();
		}

		/** The items drawn faded out, named by their authored (document) order. */
		function fadedOut(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			const order = ['bar', 'badge'];
			return wrapper.findAll('[data-graphic-item-kind="shape"]')
				.flatMap((node, index) => (node.attributes('style') ?? '').includes('opacity: 0')
					? [order[index]]
					: []);
		}

		beforeEach(() => {
			mockConfig.value = animatedConfig();
			mockIsPreview.value = true;
		});

		it.each([
			[
				'the whole composition',
				{},
				['bar', 'badge'],
			],
			[
				'the selected Graphic Item alone',
				{ itemId: 'badge' },
				['badge'],
			],
			[
				'nothing for a run naming another composition',
				{ graphicId: 'lower-third' },
				[],
			],
		])('plays %s from the start of its phase', async (_case, plan, moving) => {
			const wrapper = await mountComponent();
			expect(fadedOut(wrapper)).toEqual([]);

			await pushRun(plan);

			expect(fadedOut(wrapper)).toEqual(moving);
		});

		it('settles at the Graphic Resting State when the run is stopped', async () => {
			const wrapper = await mountComponent();
			await pushRun({});
			await pushRun(null);

			expect(fadedOut(wrapper)).toEqual([]);
		});

		it('never animates a live Screen Output from a pushed run', async () => {
			mockIsPreview.value = false;

			const wrapper = await mountComponent();
			await pushRun({});

			expect(fadedOut(wrapper)).toEqual([]);
		});

		// A run moves Graphic Items only; the Frame's Animation Effect keeps drawing.
		it('keeps the Frame\'s Animation Effect running through a run', async () => {
			mockTheme.value = {
				'animation-effect': { effect: 'net' },
			};
			const wrapper = mount(Display, {
				global: {
					stubs: {
						FeatureMatchOverlayFrameMedia: true,
						ScreenAnimationEffectSurface: { template: '<div data-testid="frame-animation-effect" />' },
					},
				},
			});
			await pushRun({});

			expect(fadedOut(wrapper)).toEqual(['bar', 'badge']);
			expect(wrapper.find('[data-testid="frame-animation-effect"]').exists()).toBe(true);
		});
	});
});
