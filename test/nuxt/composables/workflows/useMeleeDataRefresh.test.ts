import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPhaseStore = { loadPhasesByEventId: vi.fn() };
const mockRoundStore = { rounds: [] as Array<{ id: number }>, loadRoundsByEventId: vi.fn() };
const mockMatchStore = {
	isLoaded: true,
	loadedRoundId: null as number | null,
	loadMatchesByEventId: vi.fn(),
	loadMatchesByRoundId: vi.fn(),
};
const mockPlayerStore = { loadPlayersByEventId: vi.fn() };
const mockPlayerDeckStore = { loadByEventId: vi.fn() };
const mockFeatureMatchStore = { loadFeatureMatchesByEventId: vi.fn() };
const mockMetagameStore = { applyRemoteInvalidated: vi.fn() };
const mockClearPlayerDeckCache = vi.hoisted(() => vi.fn());

mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('clearPlayerDeckCache', () => mockClearPlayerDeckCache);

describe('useMeleeDataRefresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMatchStore.isLoaded = true;
		mockMatchStore.loadedRoundId = null;
		mockRoundStore.rounds = [];
	});

	it('refreshes structure, feature slots, and the current match scope together', async () => {
		mockMatchStore.loadedRoundId = 8;
		mockRoundStore.rounds = [{ id: 8 }];
		const { refreshMeleeStructureData } = useMeleeDataRefresh();

		await refreshMeleeStructureData(1);

		expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
		expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
		expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 8);
		expect(mockMatchStore.loadMatchesByEventId).not.toHaveBeenCalled();
		expect(mockClearPlayerDeckCache).toHaveBeenCalledOnce();
	});

	it('resets a match scope whose round was deleted by structure reconciliation', async () => {
		mockMatchStore.loadedRoundId = 8;
		mockRoundStore.rounds = [];
		const { refreshMeleeStructureData } = useMeleeDataRefresh();

		await refreshMeleeStructureData(1);

		expect(mockMatchStore.loadMatchesByEventId).toHaveBeenCalledWith(1);
		expect(mockMatchStore.loadMatchesByRoundId).not.toHaveBeenCalled();
	});

	it('reloads every affected projection and invalidates derived caches after a destructive reset', async () => {
		const { refreshAfterMeleeReset } = useMeleeDataRefresh();

		await refreshAfterMeleeReset(1);

		expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		expect(mockClearPlayerDeckCache).toHaveBeenCalledOnce();
		expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
		expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
		expect(mockMatchStore.loadMatchesByEventId).toHaveBeenCalledWith(1);
		expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
		expect(mockPlayerDeckStore.loadByEventId).toHaveBeenCalledWith(1);
		expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
	});
});
