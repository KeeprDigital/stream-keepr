import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMatch } from '~~/test/helpers/fixtures';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	promote: vi.fn(),
};

const featureMatches = vi.hoisted(() => ({ value: [] as Array<{ matchId: number }> }));

mockNuxtImport('useMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchStore', () => () => ({ featureMatches: featureMatches.value }));

const { deliver } = realtimeHandlersFor();

describe('useMatchStore', () => {
	let store: ReturnType<typeof useMatchStore>;

	beforeEach(() => {
		store = useMatchStore();
		store.$reset();
		featureMatches.value = [];
		mockRepo.list.mockResolvedValue([]);
	});

	describe('a peer\'s new Match while one Round is loaded', () => {
		it.each([
			['that Round', 5, 1],
			['another Round', 99, 0],
		])('is held when it belongs to %s', async (_, roundId, held) => {
			await store.loadMatchesByRoundId(1, 5);

			deliver('match:created', {
				match: createMockMatch({ id: 10, eventId: 1, roundId }),
			} as never);

			expect(store.matches).toHaveLength(held);
		});

		it('is held from any Round once the whole Event is loaded', async () => {
			await store.loadMatchesByRoundId(1, 5);
			await store.loadMatchesByEventId(1);

			deliver('match:created', {
				match: createMockMatch({ id: 10, eventId: 1, roundId: 99 }),
			} as never);

			expect(store.matches).toHaveLength(1);
		});
	});

	describe('a Round\'s refreshed Matches', () => {
		it('reload the Round when it is the one loaded', async () => {
			await store.loadMatchesByRoundId(1, 5);
			const refreshed = [
				createMockMatch({ id: 20, eventId: 1, roundId: 5 }),
			];
			mockRepo.list.mockResolvedValue(refreshed);

			await store.applyRemoteMatchesRefreshed({ eventId: 1, roundId: 5 } as never);

			expect(mockRepo.list).toHaveBeenLastCalledWith(1, 5);
			expect(store.matches).toEqual(refreshed);
		});

		it.each([
			[
				'another Round',
				{ eventId: 1, roundId: 6 },
			],
			[
				'another Event',
				{ eventId: 2, roundId: 5 },
			],
		])('leave the Matches alone when they are for %s', async (_, data) => {
			await store.loadMatchesByRoundId(1, 5);
			mockRepo.list.mockClear();

			await store.applyRemoteMatchesRefreshed(data as never);

			expect(mockRepo.list).not.toHaveBeenCalled();
		});
	});

	it('labels a promoted Match by its Feature Match slot, and an unpromoted one not at all', () => {
		featureMatches.value = [
			{ matchId: 7 },
			{ matchId: 3 },
		];

		expect(store.getFeatureMatchLabel(3)).toBe('Match 2');
		expect(store.getFeatureMatchLabel(4)).toBeNull();
	});
});
