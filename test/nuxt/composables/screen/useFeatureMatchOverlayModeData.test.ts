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
	config.layout.items = [{ ...config.layout.items[0]!, id: sourceItemId }];
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
		expect(data().config.value.layout.items[0]?.id).toBe('saved-source');

		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();

		expect(data().config.value.layout.items[0]?.id).toBe('working-source');
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

		expect(data().config.value.layout.items[0]?.id).toBe('saved-source');
		wrapper.unmount();
	});
});
