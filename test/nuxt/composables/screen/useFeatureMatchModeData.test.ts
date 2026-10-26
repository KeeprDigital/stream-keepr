import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, nextTick, ref } from 'vue';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';

const mockEventStore = {
	event: createMockEvent(),
	$reset: vi.fn(),
};

const mockFeatureMatchStore = {
	featureMatches: [] as { id: number }[],
	loadFeatureMatchesByEventId: vi.fn(),
	holdFeatureMatch: vi.fn(),
	currentEventId: null as number | null,
	isLoaded: false,
};

const mockState = createMockFeatureMatchState();
const mockFeatureMatchStateStore = {
	featureMatchStates: new Map([
		[1, mockState],
	]),
	loadState: vi.fn(),
	readSessionsAsScreenOutput: vi.fn((_read: (slotId: number) => Promise<unknown>) => vi.fn()),
	currentEventId: null as number | null,
};

/** The Slot each Screen Output read answers, by Slot id. */
function slotRead(slotId: number) {
	return {
		slot: {
			id: slotId,
			player1Data: { name: 'A' },
			player2Data: { name: 'B' },
			activeSession: { id: 70 + slotId, slotId },
		},
		match: null,
		round: null,
		phase: null,
	};
}

const mockApiFetch = vi.hoisted(() => vi.fn());
mockNuxtImport('$fetch', () => mockApiFetch);

const mockEventId = ref<number | null>(1);
const mockConfig = ref({ featureMatchId: 1 as number | null });
const mockConnectionState = ref('connected');

const continuity = createContinuitySignal();

mockNuxtImport('tryUseRealtime', () => () => ({
	get connectionState() { return mockConnectionState.value; },
	tokenError: null,
	onChannel: () => () => {},
	onContinuityLost: continuity.onContinuityLost,
	onceAttached: vi.fn(() => () => {}),
}));

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({
		id: 1,
		name: 'Test',
		modeConfigs: {
			'feature-match': { featureMatchId: 1 },
		},
	}),
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mockConfig.value));

describe('useFeatureMatchModeData', () => {
	let activeScope: ReturnType<typeof effectScope> | null = null;

	beforeEach(() => {
		vi.clearAllMocks();
		mockEventId.value = 1;
		mockConfig.value = { featureMatchId: 1 };
		mockConnectionState.value = 'connected';
		mockFeatureMatchStore.featureMatches = [];
		mockFeatureMatchStore.currentEventId = null;
		mockFeatureMatchStore.isLoaded = false;
		mockFeatureMatchStore.holdFeatureMatch.mockImplementation((slot: { id: number }) => {
			mockFeatureMatchStore.featureMatches = [
				...mockFeatureMatchStore.featureMatches.filter(held => held.id !== slot.id),
				slot,
			];
			return true;
		});
		mockApiFetch.mockImplementation(async (path: string) => {
			const slotId = Number(/feature-match-slots\/(\d+)$/.exec(path)?.[1]);
			if (!slotId)
				throw new Error(`unexpected request ${path}`);
			return slotRead(slotId);
		});
		mockFeatureMatchStateStore.featureMatchStates = new Map([
			[1, mockState],
		]);
		mockFeatureMatchStateStore.currentEventId = null;
		mockFeatureMatchStateStore.loadState.mockImplementation(async (eventId: number, matchId: number) => {
			mockFeatureMatchStateStore.currentEventId = eventId;
			const nextState = matchId === 1
				? mockState
				: createMockFeatureMatchState();
			mockFeatureMatchStateStore.featureMatchStates.set(matchId, nextState);
			return nextState;
		});
	});

	afterEach(() => {
		activeScope?.stop();
		activeScope = null;
	});

	function createComposable() {
		activeScope?.stop();
		activeScope = effectScope();
		return activeScope.run(() => useFeatureMatchModeData())!;
	}

	it('returns expected properties', () => {
		const result = createComposable();
		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('match');
		expect(result).toHaveProperty('matchState');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
	});

	it('resolves match when matchId is configured', async () => {
		const { match } = createComposable();

		await flushPromises();

		expect(match.value?.id).toBe(1);
	});

	it('reads the Slot through its Screen and holds it, never the Event\'s Slots', async () => {
		createComposable();

		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/screen-output/events/1/screens/1/feature-match-slots/1',
			expect.anything(),
		);
		expect(mockFeatureMatchStore.holdFeatureMatch).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
		expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).not.toHaveBeenCalled();
	});

	it('reads the newly configured Slot when the configured match changes', async () => {
		createComposable();
		await flushPromises();

		mockApiFetch.mockClear();
		mockConfig.value = { featureMatchId: 2 };

		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/screen-output/events/1/screens/1/feature-match-slots/2',
			expect.anything(),
		);
	});

	it('reads Session state through the Screen and never starts a Session', async () => {
		createComposable();
		await flushPromises();

		const read = mockFeatureMatchStateStore.readSessionsAsScreenOutput.mock.calls[0]?.[0] as
			(slotId: number) => Promise<unknown>;
		await expect(read(1)).resolves.toEqual({ id: 71, slotId: 1 });
		expect(mockApiFetch.mock.calls.every(([, options]) => !(options as { method?: string } | undefined)?.method)).toBe(true);
	});

	/**
	 * Ably drops message continuity after a couple of minutes suspended, and a
	 * Feature Match command carries nothing that could tell a client it fell
	 * behind — so a Screen that missed a score while away sat on the last command
	 * that arrived until the next one did, which on a slow match is minutes (#307).
	 */
	describe('a connection that was suspended and came back', () => {
		async function suspendAndResume() {
			mockConnectionState.value = 'suspended';
			await nextTick();
			mockConnectionState.value = 'connected';
			continuity.reattach('event:1');
			await nextTick();
			await flushPromises();
		}

		it('re-reads the Slot and its Session through the Screen, with no resync of its own', async () => {
			createComposable();
			await flushPromises();
			mockApiFetch.mockClear();
			mockFeatureMatchStore.holdFeatureMatch.mockClear();

			await suspendAndResume();

			expect(mockApiFetch).toHaveBeenCalledWith(
				'/api/screen-output/events/1/screens/1/feature-match-slots/1',
				expect.anything(),
			);
			expect(mockFeatureMatchStore.holdFeatureMatch).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
			expect(mockFeatureMatchStateStore.loadState).not.toHaveBeenCalled();
		});

		it('does not re-read the moment it disconnects', async () => {
			createComposable();
			await flushPromises();
			mockApiFetch.mockClear();

			mockConnectionState.value = 'suspended';
			await nextTick();
			await flushPromises();

			expect(mockApiFetch).not.toHaveBeenCalled();
		});
	});
});
