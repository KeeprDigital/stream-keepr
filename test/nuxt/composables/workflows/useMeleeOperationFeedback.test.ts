import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent } from '~~/test/helpers/fixtures';

/*
 * The toast a Melee operation leaves, over the real Melee store and the stores it
 * reloads. Faked: the Event repository, `$fetch`, and the toast the operator reads.
 */

const mockEventRepo = {
	getById: vi.fn(),
	syncSpecificRound: vi.fn(),
};
const mockToast = {
	add: vi.fn(),
};
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('$fetch', () => mockFetch);

const committed = {
	success: true,
	round: {
		id: 20,
		name: 'Round 2',
		roundNumber: 2,
		phaseId: 1,
	},
	matchCount: 1,
	created: 1,
	updated: 0,
	warnings: [],
};

/** Every Event Data reload lands, but those of one resource. */
function reloadsLandBut(failing?: string) {
	mockFetch.mockImplementation(async (path: string) => {
		if (failing && path.endsWith(`/${failing}`))
			throw new Error(`${failing} offline`);
		return [];
	});
}

function syncRound(roundId = 20) {
	return useMeleeOperationFeedback().reportMeleeOperation(() => useMeleeStore().syncSpecificRound(roundId));
}

describe('useMeleeOperationFeedback', () => {
	beforeEach(() => {
		for (const store of [
			useMeleeStore(),
			useEventStore(),
			useRoundStore(),
			useMatchStore(),
			usePlayerStore(),
			useFeatureMatchStore(),
			useFeatureMatchStateStore(),
			useMetagameStore(),
		])
			store.$reset();
		const event = {
			...createMockEvent(),
			talents: [],
			meleeConfigured: false,
		};
		useEventStore().setEvent(event as never);
		mockEventRepo.getById.mockResolvedValue(event);
		mockEventRepo.syncSpecificRound.mockResolvedValue(committed);
		reloadsLandBut();
	});

	// The operator reads the Melee store's own words for the operation, on any page.
	it.each([
		{
			outcome: 'a committed sync whose Players reload failed',
			arrange: () => reloadsLandBut('players'),
			toast: {
				title: 'Round Synced — Reload Needed',
				description: expect.stringContaining('this browser could not reload all affected data'),
				color: 'warning',
			},
		},
		{
			outcome: 'a committed sync whose reloads all landed',
			arrange: () => {},
			toast: {
				title: 'Round Synced',
				description: 'Round 2 synced successfully',
				color: 'success',
			},
		},
		{
			outcome: 'a sync Melee refused',
			arrange: () => mockEventRepo.syncSpecificRound.mockRejectedValue(new Error('Melee refused the sync')),
			toast: {
				title: 'Round Sync Failed',
				description: 'Melee refused the sync',
				color: 'error',
			},
		},
	])('tells the operator what the store recorded of $outcome', async ({ arrange, toast }) => {
		arrange();

		await syncRound();

		expect(mockToast.add.mock.calls).toEqual([
			[toast],
		]);
	});

	// An operation that recorded nothing must not repeat what an earlier one recorded.
	it('reports a refused start in its own words, not the earlier operation\'s', async () => {
		await syncRound();
		mockToast.add.mockClear();
		const running = deferred<typeof committed>();
		mockEventRepo.syncSpecificRound.mockReturnValue(running.promise);
		const first = syncRound(20);

		await syncRound(30);

		expect(mockToast.add.mock.calls).toEqual([
			[
				{
					title: 'Operation Failed',
					description: 'Round sync already in progress',
					color: 'error',
				},
			],
		]);
		running.resolve(committed);
		await first;
	});
});
