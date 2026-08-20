import type { FeatureMatchAssignment } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepo = {
	listByRound: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};

mockNuxtImport('useFeatureMatchAssignmentRepository', () => () => mockRepo);

function assignment(overrides: Partial<FeatureMatchAssignment> = {}): FeatureMatchAssignment {
	return {
		id: 1,
		eventId: 1,
		roundId: 10,
		slotId: 100,
		matchId: 1000,
		note: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

describe('useFeatureMatchAssignmentStore', () => {
	let store: ReturnType<typeof useFeatureMatchAssignmentStore>;

	beforeEach(() => {
		store = useFeatureMatchAssignmentStore();
		store.$reset();
		vi.clearAllMocks();
	});

	it('keeps simultaneously consumed Round collections instead of replacing one with another', async () => {
		const round10 = assignment({ id: 1, roundId: 10 });
		const round11 = assignment({ id: 2, roundId: 11 });
		mockRepo.listByRound
			.mockResolvedValueOnce([round10])
			.mockResolvedValueOnce([round11]);
		store.consumeRound(1, 10);
		store.consumeRound(1, 11);

		await store.loadAssignments(1, 10);
		await store.loadAssignments(1, 11);

		expect(store.assignmentsForRound(10)).toEqual([round10]);
		expect(store.assignmentsForRound(11)).toEqual([round11]);
	});

	it('discards an older Round load when a newer load finishes first', async () => {
		let resolveOlder!: (assignments: FeatureMatchAssignment[]) => void;
		let resolveNewer!: (assignments: FeatureMatchAssignment[]) => void;
		mockRepo.listByRound
			.mockReturnValueOnce(new Promise(resolve => resolveOlder = resolve))
			.mockReturnValueOnce(new Promise(resolve => resolveNewer = resolve));

		const olderLoad = store.loadAssignments(1, 10);
		const newerLoad = store.loadAssignments(1, 10);
		const newer = assignment({ id: 2, roundId: 10, note: 'Newest accepted state' });
		resolveNewer([newer]);
		await newerLoad;
		expect(store.assignmentsForRound(10)).toEqual([newer]);

		resolveOlder([assignment({ id: 1, roundId: 10, note: 'Stale response' })]);
		await olderLoad;
		expect(store.assignmentsForRound(10)).toEqual([newer]);
	});

	it('applies a peer update only to a Round collection already being consumed', async () => {
		const existing = assignment({ id: 1, roundId: 10, note: 'Old' });
		mockRepo.listByRound.mockResolvedValue([existing]);
		store.consumeRound(1, 10);
		await store.loadAssignments(1, 10);

		store.applyRemoteUpdated({
			eventId: 1,
			timestamp: Date.now(),
			featureMatchAssignment: assignment({ id: 1, roundId: 10, note: 'Peer change' }),
		});
		store.applyRemoteCreated({
			eventId: 1,
			timestamp: Date.now(),
			featureMatchAssignment: assignment({ id: 2, roundId: 11, note: 'Unconsumed' }),
		});

		expect(store.assignmentsForRound(10)[0]?.note).toBe('Peer change');
		expect(store.assignmentsForRound(11)).toEqual([]);
		expect(store.isRemoteChanged(1)).toBe(true);
	});

	it('keeps applying peer changes to a loaded Round after its mounted consumer releases it', async () => {
		const release = store.consumeRound(1, 10);
		mockRepo.listByRound.mockResolvedValue([assignment({ id: 1, roundId: 10, note: 'Before' })]);
		await store.loadAssignments(1, 10);
		release();

		store.applyRemoteUpdated({
			eventId: 1,
			featureMatchAssignment: assignment({ id: 1, roundId: 10, note: 'After release' }),
		});
		expect(store.assignmentsForRound(10)[0]?.note).toBe('After release');

		store.applyRemoteDeleted({ eventId: 1, featureMatchAssignmentId: 1 });
		expect(store.assignmentsForRound(10)).toEqual([]);
	});

	it('applies local save responses only to their owning Round collection', async () => {
		const round10 = assignment({ id: 1, roundId: 10, note: 'Round 10' });
		const round11 = assignment({ id: 2, roundId: 11, note: 'Round 11' });
		mockRepo.listByRound
			.mockResolvedValueOnce([round10])
			.mockResolvedValueOnce([round11]);
		await store.loadAssignments(1, 10);
		await store.loadAssignments(1, 11);
		const saved = assignment({ id: 1, roundId: 10, note: 'Updated locally' });
		mockRepo.update.mockResolvedValue(saved);

		await store.updateAssignment(1, 1, { note: 'Updated locally' });

		expect(store.assignmentsForRound(10)).toEqual([saved]);
		expect(store.assignmentsForRound(11)).toEqual([round11]);
	});

	it('reloads every consumed Round after reconnect without clearing accepted Notes first', async () => {
		const old10 = assignment({ id: 1, roundId: 10, note: 'Held while disconnected' });
		const old11 = assignment({ id: 2, roundId: 11, note: 'Also held' });
		mockRepo.listByRound
			.mockResolvedValueOnce([old10])
			.mockResolvedValueOnce([old11]);
		store.consumeRound(1, 10);
		store.consumeRound(1, 11);
		await store.loadAssignments(1, 10);
		await store.loadAssignments(1, 11);

		mockRepo.listByRound.mockReset();
		mockRepo.listByRound
			.mockResolvedValueOnce([assignment({ id: 1, roundId: 10, note: 'Authoritative 10' })])
			.mockResolvedValueOnce([assignment({ id: 2, roundId: 11, note: 'Authoritative 11' })]);
		const reload = store.reloadConsumedRounds();

		expect(store.assignmentsForRound(10)[0]?.note).toBe('Held while disconnected');
		expect(store.assignmentsForRound(11)[0]?.note).toBe('Also held');
		await reload;
		expect(mockRepo.listByRound).toHaveBeenCalledWith(1, 10);
		expect(mockRepo.listByRound).toHaveBeenCalledWith(1, 11);
		expect(store.assignmentsForRound(10)[0]?.note).toBe('Authoritative 10');
		expect(store.assignmentsForRound(11)[0]?.note).toBe('Authoritative 11');
	});

	it('reloads only Rounds that still have mounted consumers', async () => {
		const releaseFirstRound10 = store.consumeRound(1, 10);
		const releaseSecondRound10 = store.consumeRound(1, 10);
		store.consumeRound(1, 11);

		releaseFirstRound10();
		expect(store.consumedRoundIds).toEqual(new Set([10, 11]));
		releaseSecondRound10();
		expect(store.consumedRoundIds).toEqual(new Set([11]));

		mockRepo.listByRound.mockResolvedValue([assignment({ id: 2, roundId: 11 })]);
		await store.reloadConsumedRounds();
		expect(mockRepo.listByRound).toHaveBeenCalledOnce();
		expect(mockRepo.listByRound).toHaveBeenCalledWith(1, 11);
	});
});
