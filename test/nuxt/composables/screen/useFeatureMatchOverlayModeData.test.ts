import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { useFeatureMatchOverlayModeData } from '~/composables/screen/useFeatureMatchOverlayModeData';

const mockEventStore = { event: null };
const mockFeatureMatchStore = {
	featureMatches: [] as { id: number; matchId: number | null }[],
	currentEventId: null as number | null,
	isLoaded: true,
	loadFeatureMatchesByEventId: vi.fn(),
};
const mockFeatureMatchStateStore = {
	featureMatchStates: new Map<number, unknown>(),
	currentEventId: null as number | null,
	loadState: vi.fn(),
};
const mockPhaseStore = { isLoaded: true, loadPhasesByEventId: vi.fn(), getPhaseById: vi.fn() };
const mockRoundStore = { isLoaded: true, loadRoundsByEventId: vi.fn(), getRoundById: vi.fn() };
const mockMatchRepository = { getById: vi.fn().mockResolvedValue(null) };

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMatchRepository', () => () => mockMatchRepository);

/**
 * A Feature Match Layout identified by the id of its one Source Item, so a
 * reading of `config` says which configuration the overlay is rendering.
 */
function layoutNamed(sourceItemId: string): FeatureMatchOverlayModeConfig {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	config.layout.sources = [{ ...config.layout.sources[0]!, id: sourceItemId }];
	return config;
}

function mountOverlay(context: Partial<ScreenContext>) {
	let data!: ReturnType<typeof useFeatureMatchOverlayModeData>;
	const Child = defineComponent({
		setup() {
			data = useFeatureMatchOverlayModeData();
			return () => h('div');
		},
	});
	const Parent = defineComponent({
		setup() {
			provideScreenContext({
				screen: ref({ id: 42, modeConfigs: { 'feature-match-overlay': layoutNamed('saved-source') } } as never),
				eventId: computed(() => 7),
				interactive: ref(false),
				overlayContainer: ref(null),
				...context,
			});
			return () => h(Child);
		},
	});

	const wrapper = mount(Parent);
	return { wrapper, data: () => data };
}

/** The editor pushes its working Feature Match Layout into the embedded preview. */
function pushPreviewConfig(config: FeatureMatchOverlayModeConfig) {
	window.dispatchEvent(new MessageEvent('message', {
		origin: window.location.origin,
		source: window.parent,
		data: { type: 'feature-match-overlay:preview-config', config },
	}));
}

describe('useFeatureMatchOverlayModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatureMatchStore.featureMatches = [];
		mockFeatureMatchStore.currentEventId = 7;
		mockFeatureMatchStore.isLoaded = true;
		mockFeatureMatchStateStore.featureMatchStates = new Map();
		mockFeatureMatchStateStore.currentEventId = 7;
		mockPhaseStore.isLoaded = true;
		mockRoundStore.isLoaded = true;
		mockMatchRepository.getById.mockResolvedValue(null);
	});

	it('renders the pushed working configuration while item guides are switched off', async () => {
		// Whether an author is looking at item guides has nothing to do with whether
		// they are looking at their unsaved edits. Gating the preview configuration on
		// the guides switch meant switching guides off silently reverted the embedded
		// preview to the saved Feature Match Layout, so guides are off here on purpose.
		const { wrapper, data } = mountOverlay({
			isPreview: ref(true),
			previewGuides: ref(false),
		});
		await flushPromises();
		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');

		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();

		expect(data().config.value.layout.sources[0]?.id).toBe('working-source');
		wrapper.unmount();
	});

	it('ignores a pushed working configuration on a live Screen Output', async () => {
		// A live Screen Output renders the saved Feature Match Layout. Nothing but an
		// embedded editor preview may be talked into rendering unsaved edits.
		const { wrapper, data } = mountOverlay({
			isPreview: ref(false),
			previewGuides: ref(false),
		});
		await flushPromises();

		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();

		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');
		wrapper.unmount();
	});

	/**
	 * The push carries unsaved authoring into a frame that renders it, so the frame
	 * takes one only from the editor that embedded it. That check is the shared
	 * `isFromExpectedSender` every other guard on this channel is built on rather
	 * than a copy of it, because a copy is what drifts (#252).
	 */
	it('ignores a working configuration pushed by anyone but the embedding editor', async () => {
		const { wrapper, data } = mountOverlay({
			isPreview: ref(true),
			previewGuides: ref(false),
		});
		await flushPromises();

		// A window that did not embed this frame.
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: { postMessage: vi.fn() } as unknown as MessageEventSource,
			data: { type: 'feature-match-overlay:preview-config', config: layoutNamed('stranger-source') },
		}));
		// The embedding window, speaking from somewhere else.
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: window.parent,
			data: { type: 'feature-match-overlay:preview-config', config: layoutNamed('cross-origin-source') },
		}));
		// The right sender, carrying no configuration at all.
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: window.parent,
			data: { type: 'feature-match-overlay:preview-config', config: null },
		}));
		await nextTick();

		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');

		// And the editor still gets through, so the three rejections above are the
		// guard working rather than the listener being absent.
		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();

		expect(data().config.value.layout.sources[0]?.id).toBe('working-source');
		wrapper.unmount();
	});

	/**
	 * Whether the canonical Feature Match Sample Dataset stands in for the Feature
	 * Match this rendering does not have.
	 *
	 * This one flag is the whole of the rule the glossary states — the dataset
	 * "never appears on a live Screen Output" — so it is proved here rather than
	 * only where it is consumed.
	 */
	describe('the canonical sample dataset', () => {
		function slotBound(featureMatchId: number | null): FeatureMatchOverlayModeConfig {
			const config = layoutNamed('saved-source');
			config.featureMatchId = featureMatchId;
			return config;
		}

		it('stands in when an editor preview has no Feature Match Slot bound', async () => {
			const { wrapper, data } = mountOverlay({ isPreview: ref(true) });
			await flushPromises();

			pushPreviewConfig(slotBound(null));
			await nextTick();

			expect(data().usesSampleDataset.value).toBe(true);
			wrapper.unmount();
		});

		it('stands aside when the preview has a Slot to show real data from', async () => {
			// An author checking a name plate against the actual finalists is checking
			// something the sample cannot tell them.
			const { wrapper, data } = mountOverlay({ isPreview: ref(true) });
			await flushPromises();

			pushPreviewConfig(slotBound(11));
			await nextTick();

			expect(data().usesSampleDataset.value).toBe(false);
			wrapper.unmount();
		});

		it('never stands in on a live Screen Output, whatever its Slot holds', async () => {
			// An unassigned Overlay renders empty on air. Invented player names would be
			// indistinguishable, to everyone watching, from real ones.
			const { wrapper, data } = mountOverlay({ isPreview: ref(false) });
			await flushPromises();

			expect(data().config.value.featureMatchId).toBeNull();
			expect(data().usesSampleDataset.value).toBe(false);
			wrapper.unmount();
		});
	});
});
