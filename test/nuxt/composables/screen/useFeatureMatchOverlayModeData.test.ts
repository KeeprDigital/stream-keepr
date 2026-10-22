import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';
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
	currentEventId: null as number | null,
	loadState: vi.fn(),
	readSessionsAsScreenOutput: vi.fn((_read: (slotId: number) => Promise<unknown>) => vi.fn()),
};
const mockConnectionState = ref('connected');
const mockApiFetch = vi.hoisted(() => vi.fn());

/** What the Screen Output read answers for a Slot following Match 300. */
function slotRead(slotId: number) {
	return {
		slot: { id: slotId, matchId: 300, activeSession: { id: 90, slotId } },
		match: { id: 300, roundId: 20 },
		round: { id: 20, name: 'Round 3', phaseId: 5 },
		phase: { id: 5, name: 'Swiss' },
	};
}

const continuity = createContinuitySignal();

type Handler = (message: Record<string, unknown>) => void;
const channelHandlers = new Map<string, Set<Handler>>();

/** An Event message, as the Event channel delivers it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const handler of channelHandlers.get(`event:7|${type}`) ?? [])
		handler({ eventId: 7, ...payload });
}

mockNuxtImport('tryUseRealtime', () => () => ({
	get connectionState() { return mockConnectionState.value; },
	tokenError: null,
	onChannel: (channel: string, type: string, handler: Handler) => {
		const key = `${channel}|${type}`;
		if (!channelHandlers.has(key))
			channelHandlers.set(key, new Set());
		channelHandlers.get(key)!.add(handler);
		return () => channelHandlers.get(key)!.delete(handler);
	},
	onContinuityLost: continuity.onContinuityLost,
	onceAttached: vi.fn(() => () => {}),
}));

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

/**
 * The editor pushes its working Feature Match Layout into the embedded preview.
 *
 * Spelled as the literal it goes on the wire as, not as
 * `FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE`. Both ends now read that
 * constant (#260), so a test written in it would move with a rename and could
 * not tell one from a no-op — while on the wire a rename is a break, silently
 * ending the exchange between an editor and a frame served different versions.
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
	mockFeatureMatchStateStore.featureMatchStates = new Map([[11, {}]]);
	return mountOverlay({
		isPreview: ref(false),
		screen: ref({ id: 42, modeConfigs: { 'feature-match-overlay': config } } as never),
	});
}

describe('useFeatureMatchOverlayModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatureMatchStore.featureMatches = [];
		mockFeatureMatchStore.currentEventId = 7;
		mockFeatureMatchStore.isLoaded = true;
		mockFeatureMatchStateStore.featureMatchStates = new Map();
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
		mockConnectionState.value = 'connected';
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
	 *
	 * Each rejection is asserted before the next message is dispatched, because a
	 * later rejection can restore the state an earlier one should never have left.
	 * Asserting once at the end let a completely open guard pass this test (#351).
	 *
	 * The fourth arm is not a sender check at all, and the name says so: the empty push
	 * comes *from* the embedding editor, and what makes it inadmissible is that it
	 * carries no configuration. It comes last, after a real one has been accepted, for
	 * the same reason from the other direction: wrongly adopting it would take the
	 * preview back off the working configuration it is showing, and against a frame that
	 * had adopted nothing yet that is indistinguishable from having rejected it. Only a
	 * working configuration it can be seen to wipe makes that arm observable at all.
	 */
	it('takes a working configuration only from the embedding editor, and never an empty push', async () => {
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
		await nextTick();
		expect(data().config.value.layout.sources[0]?.id).toBe('saved-source');

		// The embedding window, speaking from somewhere else.
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://example.invalid',
			source: window.parent,
			data: { type: 'feature-match-overlay:preview-config', config: layoutNamed('cross-origin-source') },
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

		wrapper.unmount();
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
			const { wrapper, data } = mountOverlay({
				isPreview: ref(false),
				screen: ref({ id: 42, modeConfigs: { 'feature-match-overlay': boundConfig(11) } } as never),
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
			wrapper.unmount();
		});

		it('reads Session state through the Screen and never starts a Session', async () => {
			const { wrapper } = mountOverlay({
				isPreview: ref(false),
				screen: ref({ id: 42, modeConfigs: { 'feature-match-overlay': boundConfig(11) } } as never),
			});
			await flushPromises();

			const read = mockFeatureMatchStateStore.readSessionsAsScreenOutput.mock.calls[0]?.[0] as
				(slotId: number) => Promise<unknown>;
			await expect(read(11)).resolves.toEqual({ id: 90, slotId: 11 });
			expect(mockApiFetch.mock.calls.every(([, options]) => !(options as { method?: string } | undefined)?.method)).toBe(true);
			wrapper.unmount();
		});

		it('shows nothing of the Slot it left when the newly selected Slot\'s read is overtaken', async () => {
			const { wrapper, data } = mountOverlay({ isPreview: ref(true) });
			pushPreviewConfig(boundConfig(11));
			await flushPromises();
			expect(data().round.value).toMatchObject({ name: 'Round 3' });

			mockFeatureMatchStore.holdFeatureMatch.mockReturnValueOnce(false);
			pushPreviewConfig(boundConfig(12));
			await flushPromises();

			expect(data().round.value).toBeUndefined();
			expect(data().sourceMatch.value).toBeNull();
			wrapper.unmount();
		});

		it('reads the Slot an editor preview pushes, which its author has not saved', async () => {
			const { wrapper } = mountOverlay({ isPreview: ref(true) });
			await flushPromises();

			pushPreviewConfig(boundConfig(12));
			await flushPromises();

			expect(mockApiFetch).toHaveBeenCalledWith(
				'/api/screen-output/events/7/screens/42/feature-match-slots/12',
				expect.anything(),
			);
			wrapper.unmount();
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

	/**
	 * The Overlay's half of the rule the Feature Match Screen holds: nothing
	 * published while this client was suspended is ever delivered late, so the only
	 * way to find out what was missed is to ask (#307).
	 */
	describe('a connection that was suspended and came back', () => {
		async function suspendAndResume() {
			mockConnectionState.value = 'suspended';
			await nextTick();
			mockConnectionState.value = 'connected';
			continuity.reattach('event:7');
			await nextTick();
			await flushPromises();
		}

		it('re-reads the Slot, its Session and its Match through the Screen, with no resync of its own', async () => {
			const { wrapper, data } = mountBoundOutput();
			await flushPromises();
			mockApiFetch.mockClear();
			mockApiFetch.mockResolvedValueOnce({
				...slotRead(11),
				slot: { id: 11, matchId: 301, activeSession: { id: 91, slotId: 11 } },
				round: { id: 21, name: 'Round 4', phaseId: 5 },
			});

			await suspendAndResume();

			expect(mockApiFetch).toHaveBeenCalledWith(
				'/api/screen-output/events/7/screens/42/feature-match-slots/11',
				expect.anything(),
			);
			expect(mockFeatureMatchStore.holdFeatureMatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: 11, matchId: 301 }));
			expect(data().round.value).toMatchObject({ name: 'Round 4' });
			expect(mockFeatureMatchStateStore.loadState).not.toHaveBeenCalled();
			wrapper.unmount();
		});

		it('does not re-read the moment it disconnects', async () => {
			const { wrapper } = mountBoundOutput();
			await flushPromises();
			mockApiFetch.mockClear();

			mockConnectionState.value = 'suspended';
			await nextTick();
			await flushPromises();

			expect(mockApiFetch).not.toHaveBeenCalled();
			wrapper.unmount();
		});

		it('keeps what it shows when the read answers a Slot overtaken by a newer promotion', async () => {
			const { wrapper, data } = mountBoundOutput();
			await flushPromises();
			mockFeatureMatchStore.holdFeatureMatch.mockReturnValueOnce(false);
			mockApiFetch.mockResolvedValueOnce({ ...slotRead(11), round: { id: 19, name: 'Round 2', phaseId: 5 } });

			await suspendAndResume();

			expect(data().round.value).toMatchObject({ name: 'Round 3' });
			wrapper.unmount();
		});
	});

	/**
	 * The Match, Round and Phase the Overlay shows are held by no store on an
	 * output, so the Event messages that change them say when to read again.
	 */
	describe('the Event Data the Overlay holds', () => {
		it('re-reads when its Slot moves to another Match', async () => {
			const { wrapper, data } = mountBoundOutput();
			await flushPromises();
			mockApiFetch.mockResolvedValueOnce({
				...slotRead(11),
				slot: { id: 11, matchId: 301, activeSession: { id: 91, slotId: 11 } },
				match: { id: 301, roundId: 21 },
				round: { id: 21, name: 'Round 4', phaseId: 5 },
			});

			deliver('featureMatch:updated', { featureMatch: { id: 11, matchId: 301 } });
			await flushPromises();

			expect(data().sourceMatch.value).toMatchObject({ id: 301 });
			expect(data().round.value).toMatchObject({ name: 'Round 4' });
			wrapper.unmount();
		});

		it('re-reads when the Round it shows changes, and not for another', async () => {
			const { wrapper } = mountBoundOutput();
			await flushPromises();
			mockApiFetch.mockClear();

			deliver('round:updated', { round: { id: 99, name: 'Round 9' } });
			deliver('featureMatch:updated', { featureMatch: { id: 11, matchId: 300 } });
			await flushPromises();
			expect(mockApiFetch).not.toHaveBeenCalled();

			deliver('round:updated', { round: { id: 20, name: 'Top 8' } });
			await flushPromises();
			expect(mockApiFetch).toHaveBeenCalledTimes(1);
			wrapper.unmount();
		});
	});
});
