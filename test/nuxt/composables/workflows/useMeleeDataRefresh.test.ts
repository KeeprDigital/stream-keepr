import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPhaseStore = {
	loadPhasesByEventId: vi.fn(),
};
const mockRoundStore = {
	rounds: [] as Array<{ id: number }>,
	loadRoundsByEventId: vi.fn(),
};
const mockMatchStore = {
	isLoaded: true,
	loadedRoundId: null as number | null,
	loadMatchesByEventId: vi.fn(),
	loadMatchesByRoundId: vi.fn(),
};
const mockPlayerStore = {
	loadPlayersByEventId: vi.fn(),
};
const mockPlayerDeckStore = {
	loadByEventId: vi.fn(),
};
const mockFeatureMatchStore = {
	loadFeatureMatchesByEventId: vi.fn(),
};
const mockMetagameStore = {
	applyRemoteInvalidated: vi.fn(),
};
const mockClearPlayerDeckCache = vi.hoisted(() => vi.fn());

mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('clearPlayerDeckCache', () => mockClearPlayerDeckCache);

/** Rounds as structure reconciliation leaves them, applied when the rounds reload. */
function roundsAfterReload(ids: number[]) {
	mockRoundStore.loadRoundsByEventId.mockImplementation(async () => {
		mockRoundStore.rounds = ids.map(id => ({ id }));
	});
}

describe('useMeleeDataRefresh', () => {
	beforeEach(() => {
		mockMatchStore.isLoaded = true;
		mockMatchStore.loadedRoundId = null;
		mockRoundStore.rounds = [{ id: 8 }];
		roundsAfterReload([8]);
	});

	describe('refreshMeleeStructureData', () => {
		it('reloads the structure, the Feature Match slots and the Matches in the loaded Round', async () => {
			mockMatchStore.loadedRoundId = 8;

			await useMeleeDataRefresh().refreshMeleeStructureData(1);

			expect(mockClearPlayerDeckCache).toHaveBeenCalledOnce();
			expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 8);
			expect(mockMatchStore.loadMatchesByEventId).not.toHaveBeenCalled();
		});

		it('widens the Match scope to the Event when reconciliation deleted the loaded Round', async () => {
			mockMatchStore.loadedRoundId = 8;
			roundsAfterReload([9]);

			await useMeleeDataRefresh().refreshMeleeStructureData(1);

			expect(mockMatchStore.loadMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMatchStore.loadMatchesByRoundId).not.toHaveBeenCalled();
		});

		it('reloads every Match when none were scoped to a Round', async () => {
			await useMeleeDataRefresh().refreshMeleeStructureData(1);

			expect(mockMatchStore.loadMatchesByEventId).toHaveBeenCalledWith(1);
		});

		it('leaves Matches unloaded when nothing had loaded them', async () => {
			mockMatchStore.isLoaded = false;

			await useMeleeDataRefresh().refreshMeleeStructureData(1);

			expect(mockMatchStore.loadMatchesByEventId).not.toHaveBeenCalled();
			expect(mockMatchStore.loadMatchesByRoundId).not.toHaveBeenCalled();
		});
	});

	it('reloads every Melee projection and invalidates derived caches after a destructive reset', async () => {
		await useMeleeDataRefresh().refreshAfterMeleeReset(1);

		expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		expect(mockClearPlayerDeckCache).toHaveBeenCalledOnce();
		for (const load of [
			mockPhaseStore.loadPhasesByEventId,
			mockRoundStore.loadRoundsByEventId,
			mockMatchStore.loadMatchesByEventId,
			mockPlayerStore.loadPlayersByEventId,
			mockPlayerDeckStore.loadByEventId,
			mockFeatureMatchStore.loadFeatureMatchesByEventId,
		])
			expect(load).toHaveBeenCalledWith(1);
	});
});
