import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMatch } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

// ── Mock Dependencies ──

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	promote: vi.fn(),
};

mockNuxtImport('useMatchRepository', () => () => mockRepo);
/*
 * `useAsyncAction` is deliberately not mocked. The copy that stood here was
 * `async fn => fn()` — it never caught, so nothing in this suite could observe what
 * this store does with a refused request, and the optimistic rollback in
 * `useStoreHelpers` never ran either. Running the real composable is what lets the
 * sentence this store reports since #262 be seen from here (#263, #241).
 */
mockNuxtImport('useFeatureMatchStore', () => () => ({ featureMatches: [] }));

const { deliver } = realtimeHandlersFor();

describe('useMatchStore', () => {
	let store: ReturnType<typeof useMatchStore>;

	beforeEach(() => {
		store = useMatchStore();
		store.$reset();
		vi.clearAllMocks();
	});

	// ── Loading ──

	describe('loadMatchesByRoundId', () => {
		it('populates state and sets hasFetched', async () => {
			const matches = [
				createMockMatch({ id: 1, roundId: 5 }),
				createMockMatch({ id: 2, roundId: 5 }),
			];
			mockRepo.list.mockResolvedValue(matches);

			await store.loadMatchesByRoundId(1, 5);

			expect(store.matches).toEqual(matches);
			expect(store.isLoaded).toBe(true);
			expect(mockRepo.list).toHaveBeenCalledWith(1, 5);
		});
	});

	describe('loadMatchesByEventId', () => {
		it('populates state', async () => {
			const matches = [
				createMockMatch({ id: 1 }),
				createMockMatch({ id: 2 }),
			];
			mockRepo.list.mockResolvedValue(matches);

			await store.loadMatchesByEventId(1);

			expect(store.matches).toEqual(matches);
			expect(store.isLoaded).toBe(true);
			expect(mockRepo.list).toHaveBeenCalledWith(1);
		});
	});

	// ── Create ──

	describe('createMatch', () => {
		it('adds match to state', async () => {
			const created = createMockMatch({ id: 3, roundId: 1 });
			mockRepo.create.mockResolvedValue(created);

			await store.createMatch(1, { roundId: 1 });

			expect(store.matches).toContainEqual(created);
		});
	});

	// ── Update (optimistic) ──

	describe('updateMatch', () => {
		it('optimistically updates then applies server response', async () => {
			const match = createMockMatch({ id: 1, tableNumber: 1 });
			store.matches = [match];

			const serverUpdated = { ...match, tableNumber: 5 };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateMatch(1, 1, { tableNumber: 5 });

			expect(store.matches[0]!.tableNumber).toBe(5);
		});
	});

	// ── Remove (optimistic) ──

	describe('removeMatch', () => {
		it('removes match from state', async () => {
			const match = createMockMatch({ id: 1 });
			store.matches = [match];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeMatch(1, 1);

			expect(store.matches).toHaveLength(0);
		});
	});

	// ── Failure reporting ──

	describe('failure reporting', () => {
		/*
		 * #262 gave this store the sentence through the Event Data lifecycle seam, but no
		 * test here could see it: the seam this suite stood in for never caught, so a
		 * refused request left the store by rejecting rather than by reporting. This is
		 * that store's own pin (#263).
		 */
		it('reports the sentence a refused create carries rather than the transport line', async () => {
			mockRepo.create.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'That Round has already been completed' },
				request: `[POST] "/api/events/1/matches"`,
			}));

			await store.createMatch(1, { roundId: 1 });

			expect(store.error).toBe('That Round has already been completed');
			expect(store.matches).toHaveLength(0);
		});
	});

	// ── Getters ──

	describe('getMatchById', () => {
		it('returns match when found', () => {
			const match = createMockMatch({ id: 5 });
			store.matches = [match];

			expect(store.getMatchById(5)).toEqual(match);
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('match:created', () => {
			it('adds match from remote message', () => {
				store.matches = [];
				// Set the current event context so the handler accepts the message
				mockRepo.list.mockResolvedValue([]);
				void store.loadMatchesByEventId(1);

				const match = createMockMatch({ id: 10, eventId: 1 });

				deliver('match:created', { match });

				expect(store.matches).toHaveLength(1);
				expect(store.matches[0]!.id).toBe(10);
			});

			it('adds match when viewing same round', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadMatchesByRoundId(1, 5);
				store.matches = [];

				const match = createMockMatch({ id: 10, eventId: 1, roundId: 5 });

				deliver('match:created', { match });

				expect(store.matches).toHaveLength(1);
			});

			it('skips match from different round when round filter active', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadMatchesByRoundId(1, 5);
				store.matches = [];

				const match = createMockMatch({ id: 10, eventId: 1, roundId: 99 });

				deliver('match:created', { match });

				expect(store.matches).toHaveLength(0);
			});

			it('skips match from different event', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadMatchesByEventId(1);
				store.matches = [];

				const match = createMockMatch({ id: 10, eventId: 999 });

				deliver('match:created', { match });

				expect(store.matches).toHaveLength(0);
			});

			it('skips duplicate matches', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadMatchesByEventId(1);

				const match = createMockMatch({ id: 10, eventId: 1 });
				store.matches = [match];

				deliver('match:created', { match });

				expect(store.matches).toHaveLength(1);
			});
		});

		describe('match:updated', () => {
			it('updates existing match from remote message', () => {
				store.matches = [
					createMockMatch({ id: 10, tableNumber: 1 }),
				];

				deliver('match:updated', {
					match: createMockMatch({ id: 10, tableNumber: 5 }),
				});

				expect(store.matches[0]!.tableNumber).toBe(5);
			});
		});

		describe('match:deleted', () => {
			it('removes match from remote message', () => {
				store.matches = [
					createMockMatch({ id: 10 }),
				];

				deliver('match:deleted', { matchId: 10 });

				expect(store.matches).toHaveLength(0);
			});
		});

		it('ignores this client\'s own match messages, which it already applied', async () => {
			mockRepo.list.mockResolvedValue([]);
			await store.loadMatchesByEventId(1);
			const held = createMockMatch({ id: 10, eventId: 1, tableNumber: 1 });
			store.matches = [held];

			deliver('match:created', {
				match: createMockMatch({ id: 11, eventId: 1 }),
			}, { fromSelf: true });
			deliver('match:updated', {
				match: { ...held, tableNumber: 5 },
			}, { fromSelf: true });
			deliver('match:deleted', { matchId: 10 }, { fromSelf: true });

			expect(store.matches).toEqual([held]);
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.matches = [
				createMockMatch(),
			];
			store.error = 'some error';

			store.$reset();

			expect(store.matches).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.isLoaded).toBe(false);
		});
	});
});
