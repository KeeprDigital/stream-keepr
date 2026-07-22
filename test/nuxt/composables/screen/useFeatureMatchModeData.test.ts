import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, ref } from 'vue';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';

const mockEventStore = {
	event: createMockEvent(),
	$reset: vi.fn(),
};

const mockFeatureMatchStore = {
	featureMatches: [{ id: 1, player1Data: { name: 'A' }, player2Data: { name: 'B' } }],
	loadFeatureMatchesByEventId: vi.fn(),
	currentEventId: null as number | null,
	isLoaded: false,
};

const mockState = createMockFeatureMatchState();
const mockFeatureMatchStateStore = {
	featureMatchStates: new Map([[1, mockState]]),
	loadState: vi.fn(),
	currentEventId: null as number | null,
};

const mockEventId = ref<number | null>(1);
const mockConfig = ref({ featureMatchId: 1 as number | null });

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test', modeConfigs: { 'feature-match': { featureMatchId: 1 } } }),
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
		mockFeatureMatchStore.featureMatches = [{ id: 1, player1Data: { name: 'A' }, player2Data: { name: 'B' } }];
		mockFeatureMatchStore.currentEventId = null;
		mockFeatureMatchStore.isLoaded = false;
		mockFeatureMatchStore.loadFeatureMatchesByEventId.mockImplementation(async (eventId: number) => {
			mockFeatureMatchStore.currentEventId = eventId;
			mockFeatureMatchStore.isLoaded = true;
			return mockFeatureMatchStore.featureMatches;
		});
		mockFeatureMatchStateStore.featureMatchStates = new Map([[1, mockState]]);
		mockFeatureMatchStateStore.currentEventId = null;
		mockFeatureMatchStateStore.loadState.mockImplementation(async (eventId: number, matchId: number) => {
			mockFeatureMatchStateStore.currentEventId = eventId;
			const nextState = matchId === 1 ? mockState : createMockFeatureMatchState();
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

	it('loads feature match list and state when current event data is stale', async () => {
		createComposable();

		await flushPromises();

		expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		expect(mockFeatureMatchStateStore.loadState).toHaveBeenCalledWith(1, 1);
	});

	it('reloads state when the configured match changes', async () => {
		mockFeatureMatchStore.currentEventId = 1;
		mockFeatureMatchStore.isLoaded = true;
		mockFeatureMatchStateStore.currentEventId = 1;

		createComposable();
		await flushPromises();

		mockFeatureMatchStateStore.loadState.mockClear();
		mockConfig.value = { featureMatchId: 2 };

		await flushPromises();

		expect(mockFeatureMatchStateStore.loadState).toHaveBeenCalledWith(1, 2);
	});
});
