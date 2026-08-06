import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Dependencies ──

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	reorder: vi.fn(),
	promoteMatch: vi.fn(),
};

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);

/*
 * `useAsyncAction` is deliberately not mocked, for the reason #245's suite gives: it is
 * the seam every action here reports through, and the hand-written copy that stood in for
 * it re-raised what it caught where the real composable resolves to `null` — so no test
 * here could say what an operator is shown. The real composable is auto-imported, does no
 * I/O and starts no timers, and it calls the same `onError` rollback the copy existed to
 * support (#241, #263).
 */

describe('useFeatureMatchStore', () => {
	let store: ReturnType<typeof useFeatureMatchStore>;

	beforeEach(() => {
		store = useFeatureMatchStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.featureMatches = {
			'featureMatch:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'featureMatch:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'featureMatch:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
			'featureMatch:reordered': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteReordered(data as any),
		};
	});

	// ── Loading ──

	describe('loadFeatureMatchesByEventId', () => {
		it('populates featureMatches state', async () => {
			const matches = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];
			mockRepo.list.mockResolvedValue(matches);

			await store.loadFeatureMatchesByEventId(1);

			expect(store.featureMatches).toEqual(matches);
			expect(store.isLoaded).toBe(true);
			expect(store.currentEventId).toBe(1);
		});
	});

	describe('getFeatureMatchById', () => {
		it('returns match from repo', async () => {
			const match = createMockFeatureMatch({ id: 1 });
			mockRepo.getById.mockResolvedValue(match);

			const result = await store.getFeatureMatchById(1, 1);

			expect(result).toEqual(match);
		});
	});

	// ── Create ──

	describe('createFeatureMatch', () => {
		it('adds match to state', async () => {
			const created = createMockFeatureMatch({ id: 3, sortOrder: 2 });
			mockRepo.create.mockResolvedValue(created);

			await store.createFeatureMatch(1, { bestOf: 3 });

			expect(store.featureMatches).toContainEqual(created);
		});
	});

	// ── Update (optimistic) ──

	describe('updateFeatureMatch', () => {
		it('optimistically updates then applies server response', async () => {
			const match = createMockFeatureMatch({ id: 1, bestOf: 3 });
			store.featureMatches = [match];

			const serverUpdated = { ...match, bestOf: 5 };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateFeatureMatch(1, 1, { bestOf: 5 });

			expect(store.featureMatches[0]!.bestOf).toBe(5);
		});
	});

	// ── Remove (optimistic) ──

	describe('removeFeatureMatch', () => {
		it('removes match from state', async () => {
			const match = createMockFeatureMatch({ id: 1 });
			store.featureMatches = [match];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeFeatureMatch(1, 1);

			expect(store.featureMatches).toHaveLength(0);
		});
	});

	// ── Reorder ──

	describe('reorderFeatureMatch', () => {
		it('optimistically swaps items and calls repo', async () => {
			store.featureMatches = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];
			store.currentEventId = 1;
			mockRepo.reorder.mockResolvedValue(undefined);

			await store.reorderFeatureMatch(1, 'down');

			expect(store.featureMatches[0]!.id).toBe(2);
			expect(store.featureMatches[1]!.id).toBe(1);
			expect(mockRepo.reorder).toHaveBeenCalledWith(1, 1, 'down');
		});
	});

	// ── Failure reporting ──

	describe('failure reporting', () => {
		it('reports the sentence a refused reorder carries, and puts the slots back', async () => {
			store.featureMatches = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];
			store.currentEventId = 1;
			mockRepo.reorder.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'The Feature Match order changed while you were reordering it' },
			}));

			await store.reorderFeatureMatch(1, 'down');

			expect(store.error).toBe('The Feature Match order changed while you were reordering it');
			expect(store.featureMatches.map(m => m.id)).toEqual([1, 2]);
		});

		it('reports the sentence a refused single-slot read carries', async () => {
			mockRepo.getById.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'That Feature Match slot is no longer part of this Event' },
				request: `[GET] "/api/events/1/feature-matches/9"`,
			}));

			await store.getFeatureMatchById(1, 9);

			expect(store.error).toBe('That Feature Match slot is no longer part of this Event');
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('featureMatch:created', () => {
			it('adds match from remote message and sorts by sortOrder', () => {
				store.featureMatches = [createMockFeatureMatch({ id: 1, sortOrder: 0 })];
				const newMatch = createMockFeatureMatch({ id: 2, sortOrder: 1 });

				ablyCallbacks.featureMatches!['featureMatch:created']!({ featureMatch: newMatch });

				expect(store.featureMatches).toHaveLength(2);
				expect(store.featureMatches[1]!.id).toBe(2);
			});

			it('skips duplicate matches', () => {
				const match = createMockFeatureMatch({ id: 1, sortOrder: 0 });
				store.featureMatches = [match];

				ablyCallbacks.featureMatches!['featureMatch:created']!({ featureMatch: match });

				expect(store.featureMatches).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				store.featureMatches = [];

				ablyCallbacks.featureMatches!['featureMatch:created']!({ featureMatch: createMockFeatureMatch({ id: 1 }) });

				expect(store.featureMatches).toHaveLength(0);
			});
		});

		describe('featureMatch:updated', () => {
			it('updates existing match from remote message', () => {
				store.featureMatches = [createMockFeatureMatch({ id: 1, bestOf: 3 })];

				ablyCallbacks.featureMatches!['featureMatch:updated']!({ featureMatch: createMockFeatureMatch({ id: 1, bestOf: 5 }) });

				expect(store.featureMatches[0]!.bestOf).toBe(5);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.featureMatches = [createMockFeatureMatch({ id: 1, bestOf: 3 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.featureMatches!['featureMatch:updated']!({ featureMatch: createMockFeatureMatch({ id: 1, bestOf: 5 }) });

				expect(store.featureMatches[0]!.bestOf).toBe(3);
			});
		});

		describe('featureMatch:deleted', () => {
			it('removes match from remote message', () => {
				store.featureMatches = [createMockFeatureMatch({ id: 1 })];

				ablyCallbacks.featureMatches!['featureMatch:deleted']!({ featureMatchId: 1 });

				expect(store.featureMatches).toHaveLength(0);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.featureMatches = [createMockFeatureMatch({ id: 1 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.featureMatches!['featureMatch:deleted']!({ featureMatchId: 1 });

				expect(store.featureMatches).toHaveLength(1);
			});
		});

		describe('featureMatch:reordered', () => {
			it('applies new sort orders and re-sorts', () => {
				store.featureMatches = [
					createMockFeatureMatch({ id: 1, sortOrder: 0 }),
					createMockFeatureMatch({ id: 2, sortOrder: 1 }),
				];

				ablyCallbacks.featureMatches!['featureMatch:reordered']!({
					featureMatches: [
						{ featureMatchId: 1, sortOrder: 1 },
						{ featureMatchId: 2, sortOrder: 0 },
					],
				});

				expect(store.featureMatches[0]!.id).toBe(2);
				expect(store.featureMatches[1]!.id).toBe(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.featureMatches = [
					createMockFeatureMatch({ id: 1, sortOrder: 0 }),
					createMockFeatureMatch({ id: 2, sortOrder: 1 }),
				];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.featureMatches!['featureMatch:reordered']!({ featureMatches: [{ featureMatchId: 1, sortOrder: 1 }, { featureMatchId: 2, sortOrder: 0 }] });

				expect(store.featureMatches[0]!.id).toBe(1);
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.featureMatches = [createMockFeatureMatch()];
			store.error = 'some error';
			store.currentEventId = 1;

			store.$reset();

			expect(store.featureMatches).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.currentEventId).toBeNull();
			expect(store.isLoaded).toBe(false);
		});
	});
});
