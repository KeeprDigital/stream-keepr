import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, ref } from 'vue';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

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

mockNuxtImport('tryUseRealtime', () => () => ({
	connectionState: 'connected',
	tokenError: null,
	onChannel: () => () => {},
	onContinuityLost: () => () => {},
	onceAttached: vi.fn(() => () => {}),
}));

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
const screenContext = screenContextOf({
	screen: ref({
		id: 1,
		name: 'Test',
		modeConfigs: {
			'feature-match': { featureMatchId: 1 },
		},
	}),
	eventId: computed(() => mockEventId.value),
});
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mockConfig.value));

describe('useFeatureMatchModeData', () => {
	let activeScope: ReturnType<typeof effectScope> | null = null;

	beforeEach(() => {
		mockEventId.value = 1;
		mockConfig.value = { featureMatchId: 1 };
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
	});

	afterEach(() => {
		activeScope?.stop();
		activeScope = null;
	});

	function createComposable() {
		activeScope?.stop();
		activeScope = effectScope();
		return activeScope.run(() => useFeatureMatchModeData(screenContext))!;
	}

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
});
