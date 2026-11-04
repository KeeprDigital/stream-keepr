import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockRound, toWire } from '~~/test/helpers/fixtures';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

describe('useRoundStore "Start now"', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		useRoundStore().$reset();
	});

	// The server stamps the start, so nothing is predicted: the Round changes only with its answer.
	it('asks the server to start the Round, and holds the start it answers', async () => {
		const store = useRoundStore();
		mockFetch.mockResolvedValueOnce({
			rounds: [
				toWire(createMockRound({ id: 7, durationMinutes: 50 })),
			],
			total: 1,
		});
		await store.loadRoundsByEventId(1);
		const answer = deferred<unknown>();
		mockFetch.mockReturnValueOnce(answer.promise);

		const started = store.startRound(1, 7);

		expect(mockFetch).toHaveBeenLastCalledWith('/api/events/1/rounds/7/start', expect.objectContaining({ method: 'POST' }));
		expect(store.getRoundById(7)?.startedAt).toBeNull();

		answer.resolve(toWire(createMockRound({
			id: 7,
			durationMinutes: 50,
			startedAt: new Date('2026-11-04T10:00:00.000Z'),
		})));
		await started;

		expect(store.getRoundById(7)).toMatchObject({ startedAt: '2026-11-04T10:00:00.000Z', durationMinutes: 50 });
	});
});
