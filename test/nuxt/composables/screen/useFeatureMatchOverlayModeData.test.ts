import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { useFeatureMatchOverlayModeData } from '~/composables/screen/useFeatureMatchOverlayModeData';

const mockEventStore = { event: null, displayEvent: null };
const mockFeatureMatchStore = {
	featureMatches: [] as { id: number; matchId: number | null }[],
	currentEventId: null as number | null,
	isLoaded: true,
	loadFeatureMatchesByEventId: vi.fn(),
	holdFeatureMatch: vi.fn(),
};
const mockFeatureMatchStateStore = {
	featureMatchStates: new Map<number, unknown>(),
	featureMatchSessions: new Map<number, unknown>(),
	sessionIdBySlotId: new Map<number, number>(),
	currentEventId: null as number | null,
	loadState: vi.fn(),
	readSessionsAsScreenOutput: vi.fn((_read: (slotId: number) => Promise<unknown>) => vi.fn()),
};
const mockApiFetch = vi.hoisted(() => vi.fn());

/** What the Screen Output read answers for a Slot following Match 300. */
function slotRead(slotId: number) {
	return {
		slot: {
			id: slotId,
			matchId: 300,
			activeSession: { id: 90, slotId },
		},
		match: { id: 300, roundId: 20 },
		round: { id: 20, name: 'Round 3', phaseId: 5 },
		phase: { id: 5, name: 'Swiss' },
	};
}

const realtime = createFakeEventChannel();
const deliver = (type: string, payload: Record<string, unknown>) => realtime.deliver(type, payload, 7);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('$fetch', () => mockApiFetch);

/**
 * A Feature Match Layout identified by the id of its one Source Item, so a
 * reading of `config` says which configuration the overlay is rendering.
 */
function layoutNamed(sourceItemId: string): FeatureMatchOverlayModeConfig {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	config.layout.sources = [
		{ ...config.layout.sources[0]!, id: sourceItemId },
	];
	return config;
}

function mountOverlay(context: Partial<ScreenContext>) {
	let data!: ReturnType<typeof useFeatureMatchOverlayModeData>;
	const Child = defineComponent({
		setup() {
			data = useFeatureMatchOverlayModeData(useScreenContext());
			return () => h('div');
		},
	});
	const Parent = defineComponent({
		setup() {
			provideScreenContext({
				screen: ref({
					id: 42,
					modeConfigs: {
						'feature-match-overlay': layoutNamed('saved-source'),
					},
				} as never),
				eventId: computed(() => 7),
				interactive: ref(false),
				overlayContainer: ref(null),
				...context,
			});
			return () => h(Child);
		},
	});

	mount(Parent);
	return {
		data: () => data,
	};
}

// Unmounted whether or not the test passed, so no rendering's `message` listener outlives its test.
enableAutoUnmount(afterEach);

/**
 * The editor pushes its working Feature Match Layout into the embedded preview,
 * spelled as the literal that goes on the wire: a rename there is a break (#260).
 */
function pushPreviewConfig(config: FeatureMatchOverlayModeConfig) {
	window.dispatchEvent(new MessageEvent('message', {
		origin: window.location.origin,
		source: window.parent,
		data: { type: 'feature-match-overlay:preview-config', config },
	}));
}

/** A live Screen Output on Slot 11, whose Session state is already cached. */
function mountBoundOutput() {
	const config = layoutNamed('saved-source');
	config.featureMatchId = 11;
	mockFeatureMatchStateStore.featureMatchStates = new Map([
		[11, {}],
	]);
	return mountOverlay({
		isPreview: ref(false),
		screen: ref({
			id: 42,
			modeConfigs: { 'feature-match-overlay': config },
		} as never),
	});
}

describe('useFeatureMatchOverlayModeData', () => {
	beforeEach(() => {
		mockFeatureMatchStore.featureMatches = [];
		mockFeatureMatchStore.currentEventId = 7;
		mockFeatureMatchStore.isLoaded = true;
		mockFeatureMatchStateStore.featureMatchStates = new Map();
		mockFeatureMatchStateStore.featureMatchSessions = new Map();
		mockFeatureMatchStateStore.sessionIdBySlotId = new Map();
		mockFeatureMatchStateStore.currentEventId = 7;
		mockFeatureMatchStore.holdFeatureMatch.mockImplementation((slot: { id: number; matchId: number | null }) => {
			mockFeatureMatchStore.featureMatches = [slot];
			return true;
		});
		mockApiFetch.mockImplementation(async (path: string) => {
			const slotId = Number(/feature-match-slots\/(\d+)$/.exec(path)?.[1]);
			if (!slotId)
				throw new Error(`unexpected request ${path}`);
			return slotRead(slotId);
		});
		realtime.transport.connectionState = 'connected';
	});

	it('renders the pushed working configuration while item guides are switched off', async () => {
		// Whether an author is looking at item guides has nothing to do with whether
		// they are looking at their unsaved edits. Gating the preview configuration on
		// the guides switch meant switching guides off silently reverted the embedded
		// preview to the saved Feature Match Layout, so guides are off here on purpose.
		const { data } = mountOverlay({
			isPreview: ref(true),
			previewGuides: ref(false),
		});
		await flushPromises();
		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');

		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();

		expect(data().config.value.layout.sources[0]?.id).toBe('working-source');
	});

	it('ignores a pushed working configuration on a live Screen Output', async () => {
		// A live Screen Output renders the saved Feature Match Layout. Nothing but an
		// embedded editor preview may be talked into rendering unsaved edits.
		const { data } = mountOverlay({
			isPreview: ref(false),
			previewGuides: ref(false),
		});
		await flushPromises();

		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();

		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');
	});

	/**
	 * Each rejection is asserted before the next message, so a later one cannot mask an
	 * earlier (#351); the empty push comes last, after a real one, so adopting it is visible.
	 */
	it('takes a working configuration only from the embedding editor, and never an empty push', async () => {
		const { data } = mountOverlay({
			isPreview: ref(true),
			previewGuides: ref(false),
		});
		await flushPromises();

		// A window that did not embed this frame.
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: {
				postMessage: vi.fn(),
			} as unknown as MessageEventSource,
			data: {
				type: 'feature-match-overlay:preview-config',
				config: layoutNamed('stranger-source'),
			},
		}));
		await nextTick();
		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');

		// The embedding window, speaking from somewhere else.
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: window.parent,
			data: {
				type: 'feature-match-overlay:preview-config',
				config: layoutNamed('cross-origin-source'),
			},
		}));
		await nextTick();
		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');

		// And the editor still gets through, so the rejections around it are the guard
		// working rather than the listener being absent.
		pushPreviewConfig(layoutNamed('working-source'));
		await nextTick();
		expect(data().config.value.layout.sources[0]?.id).toBe('working-source');

		// The right sender, carrying no configuration at all. Adopting it would take
		// the preview back off the working configuration it is now showing.
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: window.parent,
			data: { type: 'feature-match-overlay:preview-config', config: null },
		}));
		await nextTick();
		expect(data().config.value.layout.sources[0]?.id).toBe('working-source');
	});

	/**
	 * A Screen Output holds no Session for the operator's Slot, Round, Phase and
	 * Match reads, so the Slot it shows comes through its Screen, carrying the
	 * Match, Round and Phase it follows (#604).
	 */
	describe('the Slot a live Screen Output shows', () => {
		function boundConfig(featureMatchId: number) {
			const config = layoutNamed('saved-source');
			config.featureMatchId = featureMatchId;
			return config;
		}

		it('reads it through the Screen, holds it, and renders its Match, Round and Phase', async () => {
			const { data } = mountOverlay({
				isPreview: ref(false),
				screen: ref({
					id: 42,
					modeConfigs: {
						'feature-match-overlay': boundConfig(11),
					},
				} as never),
			});
			await flushPromises();

			expect(mockApiFetch).toHaveBeenCalledWith(
				'/api/screen-output/events/7/screens/42/feature-match-slots/11',
				expect.anything(),
			);
			expect(mockApiFetch.mock.calls.every(([path]) => String(path).startsWith('/api/screen-output/'))).toBe(true);
			expect(mockFeatureMatchStore.holdFeatureMatch).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).not.toHaveBeenCalled();
			expect(data().sourceMatch.value).toMatchObject({ id: 300 });
			expect(data().round.value).toMatchObject({ name: 'Round 3' });
			expect(data().phase.value).toMatchObject({ name: 'Swiss' });
		});

		it('reads the Slot an editor preview pushes, which its author has not saved', async () => {
			mountOverlay({
				isPreview: ref(true),
			});
			await flushPromises();

			pushPreviewConfig(boundConfig(12));
			await flushPromises();

			expect(mockApiFetch).toHaveBeenCalledWith(
				'/api/screen-output/events/7/screens/42/feature-match-slots/12',
				expect.anything(),
			);
		});
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
			const { data } = mountOverlay({
				isPreview: ref(true),
			});
			await flushPromises();

			pushPreviewConfig(slotBound(null));
			await nextTick();

			expect(data().usesSampleDataset.value).toBe(true);
		});

		it('stands aside when the preview has a Slot to show real data from', async () => {
			// An author checking a name plate against the actual finalists is checking
			// something the sample cannot tell them.
			const { data } = mountOverlay({
				isPreview: ref(true),
			});
			await flushPromises();

			pushPreviewConfig(slotBound(11));
			await nextTick();

			expect(data().usesSampleDataset.value).toBe(false);
		});

		it('never stands in on a live Screen Output, whatever its Slot holds', async () => {
			// An unassigned Overlay renders empty on air. Invented player names would be
			// indistinguishable, to everyone watching, from real ones.
			const { data } = mountOverlay({
				isPreview: ref(false),
			});
			await flushPromises();

			expect(data().config.value.featureMatchId).toBeNull();
			expect(data().usesSampleDataset.value).toBe(false);
		});
	});

	/**
	 * The Match, Round and Phase the Overlay shows are held by no store on an
	 * output, so the Event messages that change them say when to read again.
	 */
	describe('the Event Data the Overlay holds', () => {
		it('re-reads when its Slot moves to another Match', async () => {
			const { data } = mountBoundOutput();
			await flushPromises();
			mockApiFetch.mockResolvedValueOnce({
				...slotRead(11),
				slot: {
					id: 11,
					matchId: 301,
					activeSession: { id: 91, slotId: 11 },
				},
				match: { id: 301, roundId: 21 },
				round: { id: 21, name: 'Round 4', phaseId: 5 },
			});

			deliver('featureMatch:updated', {
				featureMatch: { id: 11, matchId: 301 },
			});
			await flushPromises();

			expect(data().sourceMatch.value).toMatchObject({ id: 301 });
			expect(data().round.value).toMatchObject({ name: 'Round 4' });
		});
	});
});
