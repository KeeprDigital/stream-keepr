import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
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

const mockAssignmentRepo = {
	listByRound: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchAssignmentRepository', () => () => mockAssignmentRepo);
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

	// ── Slot answers overtaken by a newer Session epoch (#635) ──

	/**
	 * A Slot's Session orders it (ADR-0026): a settings answer or a load carrying a
	 * Session from an epoch this client has seen end was read before a newer Slot
	 * Promotion or clearing, so that Slot is left behind whole.
	 */
	describe('a Slot answer read before a newer Session epoch', () => {
		const stateStore = () => useFeatureMatchStateStore();

		beforeEach(() => {
			stateStore().$reset();
		});

		function announce(slot: ReturnType<typeof slotInEpoch>) {
			ablyCallbacks.featureMatches!['featureMatch:updated']!({ featureMatch: slot });
		}

		it('a settings answer from an ended epoch does not replace the held Slot, and answers with it', async () => {
			store.featureMatches = [slotInEpoch(1, 501)];
			stateStore().offerSlotSession(store.featureMatches[0]!);
			const update = deferred<ReturnType<typeof slotInEpoch>>();
			mockRepo.update.mockReturnValueOnce(update.promise);

			const updating = store.updateFeatureMatch(1, 1, { bestOf: 5 });
			const promoted = slotInEpoch(1, 502, { bestOf: 5 });
			announce(promoted);
			update.resolve(slotInEpoch(1, 501, { bestOf: 5 }));

			expect(await updating).toEqual(promoted);
			expect(store.featureMatches).toEqual([promoted]);
		});

		it('a same-epoch settings answer replaces the held Slot', async () => {
			store.featureMatches = [slotInEpoch(1, 501)];
			stateStore().offerSlotSession(store.featureMatches[0]!);
			const answered = slotInEpoch(1, 501, { bestOf: 5 });
			mockRepo.update.mockResolvedValueOnce(answered);

			await store.updateFeatureMatch(1, 1, { bestOf: 5 });

			expect(store.featureMatches).toEqual([answered]);
		});

		it('a load keeps a Slot held from a newer epoch and applies the rest', async () => {
			mockRepo.list.mockResolvedValueOnce([slotInEpoch(1, 501), slotInEpoch(2, 601)]);
			await store.loadFeatureMatchesByEventId(1);
			const load = deferred<ReturnType<typeof slotInEpoch>[]>();
			mockRepo.list.mockReturnValueOnce(load.promise);

			const loading = store.loadFeatureMatchesByEventId(1);
			const promoted = slotInEpoch(1, 502);
			announce(promoted);
			const sameEpoch = slotInEpoch(2, 601, { bestOf: 5 });
			load.resolve([slotInEpoch(1, 501, { bestOf: 5 }), sameEpoch]);
			await loading;

			expect(store.featureMatches).toEqual([promoted, sameEpoch]);
		});
	});

	// ── Slot answers read before the Slot's first Session (#658) ──

	/**
	 * No server path moves a Slot from holding a Session to holding none: every
	 * close opens its successor in the same commit (ADR-0026, ADR-0029). A Slot
	 * read without one was read before its first Session opened, so it is behind
	 * any Session this client holds for that Slot, and is left behind whole.
	 */
	describe('a Slot read without a Session', () => {
		const stateStore = () => useFeatureMatchStateStore();

		beforeEach(() => {
			stateStore().$reset();
		});

		function announce(slot: ReturnType<typeof createMockFeatureMatch>) {
			ablyCallbacks.featureMatches!['featureMatch:updated']!({ featureMatch: slot });
		}

		it('an announcement does not replace a Slot holding a Session', () => {
			const promoted = slotInEpoch(1, 501);
			store.featureMatches = [promoted];
			stateStore().offerSlotSession(promoted);

			announce(sessionlessSlot(1, { bestOf: 5 }));

			expect(store.featureMatches).toEqual([promoted]);
		});

		it('a settings answer does not replace a Slot holding a Session, and answers with it', async () => {
			store.featureMatches = [sessionlessSlot(1)];
			const update = deferred<ReturnType<typeof createMockFeatureMatch>>();
			mockRepo.update.mockReturnValueOnce(update.promise);

			const updating = store.updateFeatureMatch(1, 1, { bestOf: 5 });
			const promoted = slotInEpoch(1, 501);
			announce(promoted);
			update.resolve(sessionlessSlot(1, { bestOf: 5 }));

			expect(await updating).toEqual(promoted);
			expect(store.featureMatches).toEqual([promoted]);
		});

		it('a load keeps a Slot holding a Session and applies the rest', async () => {
			mockRepo.list.mockResolvedValueOnce([sessionlessSlot(1), sessionlessSlot(2)]);
			await store.loadFeatureMatchesByEventId(1);
			const load = deferred<ReturnType<typeof createMockFeatureMatch>[]>();
			mockRepo.list.mockReturnValueOnce(load.promise);

			const loading = store.loadFeatureMatchesByEventId(1);
			const promoted = slotInEpoch(1, 501);
			announce(promoted);
			const stillEmpty = sessionlessSlot(2, { bestOf: 5 });
			load.resolve([sessionlessSlot(1, { bestOf: 5 }), stillEmpty]);
			await loading;

			expect(store.featureMatches).toEqual([promoted, stillEmpty]);
		});

		it('a Screen Output read is not held over a Slot holding a Session', () => {
			const promoted = slotInEpoch(1, 501);
			expect(store.holdFeatureMatch(promoted)).toBe(true);

			expect(store.holdFeatureMatch(sessionlessSlot(1))).toBe(false);
			expect(store.featureMatches).toEqual([promoted]);
		});

		it('a saved Slot does not replace a Slot holding a Session', () => {
			const promoted = slotInEpoch(1, 501);
			store.featureMatches = [promoted];
			stateStore().offerSlotSession(promoted);

			expect(store.applySavedSlot(sessionlessSlot(1, { bestOf: 5 }))).toBe(false);
			expect(store.featureMatches).toEqual([promoted]);
		});

		it('applies while no Session is held for the Slot', () => {
			store.featureMatches = [sessionlessSlot(1)];
			const edited = sessionlessSlot(1, { bestOf: 5 });

			announce(edited);

			expect(store.featureMatches).toEqual([edited]);
		});
	});

	// ── Writes that outlive their Event (#606) ──

	/**
	 * A Slot write is answered for the Event it was made in. Neither another Event nor
	 * the same Event loaded afresh since is the lifetime that answer belongs to, so it
	 * may not add a Slot, prime a Feature Match Session, or put back an order there.
	 */
	describe.each([
		['Event B', [2]],
		['Event A, loaded again since', [2, 1]],
	])('a Slot write answered after the operator moved on to %s', (_, switches) => {
		const stateStore = () => useFeatureMatchStateStore();

		/** Ends on Slots 1 and 2, as Event A's own are when loaded again. */
		async function switchAway() {
			let shown!: ReturnType<typeof createMockFeatureMatch>[];
			for (const eventId of switches) {
				shown = [
					createMockFeatureMatch({ id: 1, eventId, sortOrder: 0, bestOf: 1 }),
					createMockFeatureMatch({ id: 2, eventId, sortOrder: 1, bestOf: 1 }),
				];
				store.$reset();
				stateStore().$reset();
				mockRepo.list.mockResolvedValueOnce(structuredClone(shown));
				await store.loadFeatureMatchesByEventId(eventId);
			}
			return shown;
		}

		it('a late create adds no Slot and primes no Feature Match Session', async () => {
			const create = deferred<ReturnType<typeof slotInEpoch>>();
			mockRepo.create.mockReturnValueOnce(create.promise);

			const creating = store.createFeatureMatch(1, { bestOf: 3 });
			const shown = await switchAway();
			create.resolve(slotInEpoch(3, 503));
			await creating;

			expect(store.featureMatches).toEqual(shown);
			expect(stateStore().featureMatchSessions.size).toBe(0);
		});

		it('a late update changes no Slot and primes no Feature Match Session', async () => {
			store.featureMatches = [createMockFeatureMatch({ id: 1, bestOf: 3 })];
			const update = deferred<ReturnType<typeof slotInEpoch>>();
			mockRepo.update.mockReturnValueOnce(update.promise);

			const updating = store.updateFeatureMatch(1, 1, { bestOf: 5 });
			const shown = await switchAway();
			update.resolve({ ...slotInEpoch(1, 501), bestOf: 5 });
			await updating;

			expect(store.featureMatches).toEqual(shown);
			expect(stateStore().featureMatchSessions.size).toBe(0);
		});

		it('a late failed reorder puts back no order and reports nothing', async () => {
			store.featureMatches = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];
			store.currentEventId = 1;
			const reorder = deferred<never>();
			mockRepo.reorder.mockReturnValueOnce(reorder.promise);

			const reordering = store.reorderFeatureMatch(1, 'down');
			const shown = await switchAway();
			reorder.reject(new Error('The Feature Match order changed'));
			await reordering;

			expect(store.featureMatches).toEqual(shown);
			expect(store.error).toBeNull();
		});

		it('a late Slot Promotion changes no Slot and no Assignment', async () => {
			const assignments = useFeatureMatchAssignmentStore();
			assignments.$reset();
			const promotion = deferred<unknown>();
			mockRepo.promoteMatch.mockReturnValueOnce(promotion.promise);

			const promoting = useFeatureMatchPromotion().promote({ eventId: 1, roundId: 10, slotId: 1, matchId: 7 });
			const shown = await switchAway();
			const eventId = switches.at(-1)!;
			const loadedAssignments = [{
				id: 9,
				eventId,
				roundId: 10,
				slotId: 2,
				matchId: 8,
				note: 'Loaded since',
				createdAt: new Date('2026-01-01T00:00:00Z'),
				updatedAt: new Date('2026-01-01T00:00:00Z'),
			}];
			assignments.$reset();
			assignments.consumeRound(eventId, 10);
			mockAssignmentRepo.listByRound.mockResolvedValueOnce(structuredClone(loadedAssignments));
			await assignments.loadAssignments(eventId, 10);
			promotion.resolve({
				promotedSlot: createMockFeatureMatch({ id: 1, matchId: 7 }),
				clearedSlots: [createMockFeatureMatch({ id: 2, matchId: null })],
				assignment: { ...loadedAssignments[0]!, eventId: 1, slotId: 1, matchId: 7, note: null },
			});
			await promoting;

			expect(store.featureMatches).toEqual(shown);
			expect(assignments.assignmentsForRound(10)).toEqual(loadedAssignments);
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

function slotInEpoch(id: number, sessionId: number, overrides: Record<string, unknown> = {}) {
	return createMockFeatureMatch({
		id,
		eventId: 1,
		matchId: sessionId,
		activeSessionId: sessionId,
		activeSession: {
			id: sessionId,
			eventId: 1,
			slotId: id,
			status: 'active',
			sourceSnapshot: {},
			currentState: createMockFeatureMatchState(),
			sequence: 1,
			closedAt: null,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		},
		...overrides,
	} as any);
}

function sessionlessSlot(id: number, overrides: Record<string, unknown> = {}) {
	return createMockFeatureMatch({
		id,
		eventId: 1,
		matchId: null,
		activeSessionId: null,
		activeSession: null,
		...overrides,
	} as any);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}
