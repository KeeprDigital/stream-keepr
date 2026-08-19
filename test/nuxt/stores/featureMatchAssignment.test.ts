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

		await store.loadAssignments(1, 10);
		await store.loadAssignments(1, 11);

		expect(store.assignmentsForRound(10)).toEqual([round10]);
		expect(store.assignmentsForRound(11)).toEqual([round11]);
	});

	it('applies a peer update only to a Round collection already being consumed', async () => {
		const existing = assignment({ id: 1, roundId: 10, note: 'Old' });
		mockRepo.listByRound.mockResolvedValue([existing]);
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

	it('reloads every consumed Round after reconnect without clearing accepted Notes first', async () => {
		const old10 = assignment({ id: 1, roundId: 10, note: 'Held while disconnected' });
		const old11 = assignment({ id: 2, roundId: 11, note: 'Also held' });
		mockRepo.listByRound
			.mockResolvedValueOnce([old10])
			.mockResolvedValueOnce([old11]);
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
});
