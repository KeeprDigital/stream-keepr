import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	reorder: vi.fn(),
	promoteMatch: vi.fn(),
};

const mockAssignmentRepo = {
	listByRound: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchAssignmentRepository', () => () => mockAssignmentRepo);

const { deliver } = realtimeHandlersFor();

function announce(slot: ReturnType<typeof createMockFeatureMatch>) {
	deliver('featureMatch:updated', { featureMatch: slot } as never);
}

describe('useFeatureMatchStore', () => {
	let store: ReturnType<typeof useFeatureMatchStore>;

	beforeEach(() => {
		store = useFeatureMatchStore();
		store.$reset();
	});

	describe('reorderFeatureMatch', () => {
		beforeEach(() => {
			store.featureMatches = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];
			store.currentEventId = 1;
		});

		it('swaps the Slots while the reorder is pending', async () => {
			const reorder = deferred<void>();
			mockRepo.reorder.mockReturnValueOnce(reorder.promise);

			const reordering = store.reorderFeatureMatch(1, 'down');

			expect(store.featureMatches.map(m => m.id)).toEqual([2, 1]);
			expect(mockRepo.reorder).toHaveBeenCalledWith(1, 1, 'down');

			reorder.resolve();
			await reordering;

			expect(store.featureMatches.map(m => m.id)).toEqual([2, 1]);
		});

		it('reports the server\'s sentence for a refused reorder and puts the Slots back', async () => {
			mockRepo.reorder.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'The Feature Match order changed while you were reordering it' },
			}));

			await store.reorderFeatureMatch(1, 'down');

			expect(store.error).toBe('The Feature Match order changed while you were reordering it');
			expect(store.featureMatches.map(m => m.id)).toEqual([1, 2]);
		});

		it.each([
			['the first Slot up', 1, 'up'],
			['the last Slot down', 2, 'down'],
		] as const)('moves nothing for %s', async (_, slotId, direction) => {
			await store.reorderFeatureMatch(slotId, direction);

			expect(mockRepo.reorder).not.toHaveBeenCalled();
			expect(store.featureMatches.map(m => m.id)).toEqual([1, 2]);
		});
	});

	describe('a peer\'s Slot messages', () => {
		it('hold a created Slot in sort order and drop a deleted one', () => {
			store.featureMatches = [
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];

			deliver('featureMatch:created', {
				featureMatch: createMockFeatureMatch({ id: 1, sortOrder: 0 }),
			} as never);

			expect(store.featureMatches.map(m => m.id)).toEqual([1, 2]);

			deliver('featureMatch:deleted', { featureMatchId: 1 } as never);

			expect(store.featureMatches.map(m => m.id)).toEqual([2]);
		});

		it('apply a reorder\'s sort orders', () => {
			store.featureMatches = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
			];

			deliver('featureMatch:reordered', {
				featureMatches: [
					{ featureMatchId: 1, sortOrder: 1 },
					{ featureMatchId: 2, sortOrder: 0 },
				],
			} as never);

			expect(store.featureMatches.map(m => m.id)).toEqual([2, 1]);
		});
	});

	// A Slot's Session orders it (ADR-0026): an answer carrying an ended epoch's Session is left behind whole (#635).
	describe('a Slot answer read before a newer Session epoch', () => {
		const stateStore = () => useFeatureMatchStateStore();

		beforeEach(() => {
			stateStore().$reset();
		});

		it('a settings answer from an ended epoch does not replace the held Slot, and answers with it', async () => {
			store.featureMatches = [
				slotInEpoch(1, 501),
			];
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
			store.featureMatches = [
				slotInEpoch(1, 501),
			];
			stateStore().offerSlotSession(store.featureMatches[0]!);
			const answered = slotInEpoch(1, 501, { bestOf: 5 });
			mockRepo.update.mockResolvedValueOnce(answered);

			await store.updateFeatureMatch(1, 1, { bestOf: 5 });

			expect(store.featureMatches).toEqual([answered]);
		});

		it('a load keeps a Slot held from a newer epoch and applies the rest', async () => {
			mockRepo.list.mockResolvedValueOnce([
				slotInEpoch(1, 501),
				slotInEpoch(2, 601),
			]);
			await store.loadFeatureMatchesByEventId(1);
			const load = deferred<ReturnType<typeof slotInEpoch>[]>();
			mockRepo.list.mockReturnValueOnce(load.promise);

			const loading = store.loadFeatureMatchesByEventId(1);
			const promoted = slotInEpoch(1, 502);
			announce(promoted);
			const sameEpoch = slotInEpoch(2, 601, { bestOf: 5 });
			load.resolve([
				slotInEpoch(1, 501, { bestOf: 5 }),
				sameEpoch,
			]);
			await loading;

			expect(store.featureMatches).toEqual([promoted, sameEpoch]);
		});
	});

	// Every Session close opens its successor (ADR-0026, ADR-0029), so a Slot read without one predates any held Session (#658).
	describe('a Slot read without a Session', () => {
		const stateStore = () => useFeatureMatchStateStore();

		beforeEach(() => {
			stateStore().$reset();
		});

		it('an announcement does not replace a Slot holding a Session', () => {
			const withSession = slotInEpoch(1, 501);
			store.featureMatches = [withSession];
			stateStore().offerSlotSession(withSession);

			announce(sessionlessSlot(1, { bestOf: 5 }));

			expect(store.featureMatches).toEqual([withSession]);
		});

		it('a settings answer does not replace a Slot holding a Session, and answers with it', async () => {
			store.featureMatches = [
				sessionlessSlot(1),
			];
			const update = deferred<ReturnType<typeof createMockFeatureMatch>>();
			mockRepo.update.mockReturnValueOnce(update.promise);

			const updating = store.updateFeatureMatch(1, 1, { bestOf: 5 });
			const withSession = slotInEpoch(1, 501);
			announce(withSession);
			update.resolve(sessionlessSlot(1, { bestOf: 5 }));

			expect(await updating).toEqual(withSession);
			expect(store.featureMatches).toEqual([withSession]);
		});

		it('a load keeps a Slot holding a Session and applies the rest', async () => {
			mockRepo.list.mockResolvedValueOnce([
				sessionlessSlot(1),
				sessionlessSlot(2),
			]);
			await store.loadFeatureMatchesByEventId(1);
			const load = deferred<ReturnType<typeof createMockFeatureMatch>[]>();
			mockRepo.list.mockReturnValueOnce(load.promise);

			const loading = store.loadFeatureMatchesByEventId(1);
			const withSession = slotInEpoch(1, 501);
			announce(withSession);
			const stillSessionless = sessionlessSlot(2, { bestOf: 5 });
			load.resolve([
				sessionlessSlot(1, { bestOf: 5 }),
				stillSessionless,
			]);
			await loading;

			expect(store.featureMatches).toEqual([withSession, stillSessionless]);
		});

		it('a Screen Output read is not held over a Slot holding a Session', () => {
			const withSession = slotInEpoch(1, 501);
			expect(store.holdFeatureMatch(withSession)).toBe(true);

			expect(store.holdFeatureMatch(sessionlessSlot(1))).toBe(false);
			expect(store.featureMatches).toEqual([withSession]);
		});

		it('a saved Slot does not replace a Slot holding a Session', () => {
			const withSession = slotInEpoch(1, 501);
			store.featureMatches = [withSession];
			stateStore().offerSlotSession(withSession);

			expect(store.applySavedSlot(sessionlessSlot(1, { bestOf: 5 }))).toBe(false);
			expect(store.featureMatches).toEqual([withSession]);
		});

		it('applies while no Session is held for the Slot', () => {
			store.featureMatches = [
				sessionlessSlot(1),
			];
			const edited = sessionlessSlot(1, { bestOf: 5 });

			announce(edited);

			expect(store.featureMatches).toEqual([edited]);
		});
	});

	// A Slot write is answered for the Event it was made in; it adds, primes and restores nothing in another (#606).
	describe.each([
		[
			'Event B',
			[2],
		],
		[
			'Event A, loaded again since',
			[2, 1],
		],
	])('a Slot write answered after the operator moved on to %s', (_, switches) => {
		const stateStore = () => useFeatureMatchStateStore();

		/** Ends on Slots 1 and 2, as Event A's own are when loaded again. */
		async function switchAway() {
			let shown!: ReturnType<typeof createMockFeatureMatch>[];
			for (const eventId of switches) {
				shown = [
					createMockFeatureMatch({
						id: 1,
						eventId,
						sortOrder: 0,
						bestOf: 1,
					}),
					createMockFeatureMatch({
						id: 2,
						eventId,
						sortOrder: 1,
						bestOf: 1,
					}),
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
			store.featureMatches = [
				createMockFeatureMatch({ id: 1, bestOf: 3 }),
			];
			const update = deferred<ReturnType<typeof slotInEpoch>>();
			mockRepo.update.mockReturnValueOnce(update.promise);

			const updating = store.updateFeatureMatch(1, 1, { bestOf: 5 });
			const shown = await switchAway();
			update.resolve({
				...slotInEpoch(1, 501),
				bestOf: 5,
			});
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

			const promoting = useFeatureMatchPromotion().promote({
				eventId: 1,
				roundId: 10,
				slotId: 1,
				matchId: 7,
			});
			const shown = await switchAway();
			const eventId = switches.at(-1)!;
			const loadedAssignments = [
				{
					id: 9,
					eventId,
					roundId: 10,
					slotId: 2,
					matchId: 8,
					note: 'Loaded since',
					createdAt: new Date('2026-01-01T00:00:00Z'),
					updatedAt: new Date('2026-01-01T00:00:00Z'),
				},
			];
			assignments.$reset();
			assignments.consumeRound(eventId, 10);
			mockAssignmentRepo.listByRound.mockResolvedValueOnce(structuredClone(loadedAssignments));
			await assignments.loadAssignments(eventId, 10);
			promotion.resolve({
				promotedSlot: createMockFeatureMatch({ id: 1, matchId: 7 }),
				clearedSlots: [
					createMockFeatureMatch({ id: 2, matchId: null }),
				],
				assignment: {
					...loadedAssignments[0]!,
					eventId: 1,
					slotId: 1,
					matchId: 7,
					note: null,
				},
			});
			await promoting;

			expect(store.featureMatches).toEqual(shown);
			expect(assignments.assignmentsForRound(10)).toEqual(loadedAssignments);
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
