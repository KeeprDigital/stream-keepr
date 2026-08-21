import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';

const featureMatchStateServiceMocks = vi.hoisted(() => ({
	createSessionForSlot: vi.fn().mockResolvedValue({ id: 1, slotId: 1 }),
	buildSourceSnapshot: vi.fn().mockResolvedValue({ slotId: 1 }),
	applyCommandToActiveSession: vi.fn().mockResolvedValue(null),
	loadEventDefaults: vi.fn().mockResolvedValue({
		game: 'mtg',
		bestOf: 3,
		startingLife: 20,
		clockType: 'countdown',
		clockDuration: 50,
		countUpAfterCountdown: false,
		turnTrackingEnabled: false,
		activePlayerTrackingEnabled: false,
		extraTurnsEnabled: true,
		extraTurns: 5,
		extraTurnsLabel: 'Extra Turns',
		mulliganTrackingEnabled: false,
	}),
}));

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	events: { id: 'events.id' },
	matches: { id: 'matches.id', eventId: 'matches.eventId' },
	featureMatchSessions: {
		id: 'featureMatchSessions.id',
		eventId: 'featureMatchSessions.eventId',
	},
	featureMatches: {
		id: 'featureMatches.id',
		eventId: 'featureMatches.eventId',
		sortOrder: 'featureMatches.sortOrder',
		matchId: 'featureMatches.matchId',
		externalId: 'featureMatches.externalId',
		externalSource: 'featureMatches.externalSource',
		player1Id: 'featureMatches.player1Id',
		player2Id: 'featureMatches.player2Id',
		activeSessionId: 'featureMatches.activeSessionId',
	},
}));
vi.mock('~~/server/services/featureMatchState', () => ({
	featureMatchStateService: () => ({
		createSessionForSlot: featureMatchStateServiceMocks.createSessionForSlot,
		buildSourceSnapshot: featureMatchStateServiceMocks.buildSourceSnapshot,
		applyCommandToActiveSession: featureMatchStateServiceMocks.applyCommandToActiveSession,
		loadEventDefaults: featureMatchStateServiceMocks.loadEventDefaults,
	}),
}));
vi.mock('~~/shared/types/featureMatchDefaults', () => ({
	DEFAULT_FEATURE_MATCH_DEFAULTS: {
		bestOf: 3,
		startingLife: 20,
		clockType: 'countdown',
		clockDuration: 50,
		countUpAfterCountdown: false,
		turnTrackingEnabled: false,
		activePlayerTrackingEnabled: false,
		extraTurnsEnabled: false,
		extraTurns: 5,
		extraTurnsLabel: 'Extra Turns',
		mulliganTrackingEnabled: false,
	},
	toFeatureMatchDefaults: (event: any) => ({
		bestOf: event?.featureMatchDefaultBestOf ?? 3,
		startingLife: event?.featureMatchDefaultStartingLife ?? 20,
		clockType: event?.featureMatchDefaultClockType ?? 'countdown',
		clockDuration: event?.featureMatchDefaultClockDuration ?? 50,
		countUpAfterCountdown: event?.featureMatchDefaultCountUpAfterCountdown ?? false,
		turnTrackingEnabled: false,
		activePlayerTrackingEnabled: false,
		extraTurnsEnabled: false,
		extraTurns: 5,
		extraTurnsLabel: 'Extra Turns',
		mulliganTrackingEnabled: false,
	}),
}));

// createError is auto-imported in Nitro
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	return err;
});

const { featureMatchService } = await import('~~/server/services/featureMatch');

describe('featureMatchService', () => {
	beforeEach(() => {
		resetDbMocks();
		featureMatchStateServiceMocks.createSessionForSlot.mockClear();
		featureMatchStateServiceMocks.buildSourceSnapshot.mockClear();
		featureMatchStateServiceMocks.applyCommandToActiveSession.mockClear();
		featureMatchStateServiceMocks.loadEventDefaults.mockClear();
	});

	describe('findById', () => {
		it('returns match when found', async () => {
			const match = createMockFeatureMatch();
			mockDb.query.featureMatches.findFirst.mockResolvedValue(match);

			const result = await featureMatchService().findById(1, 1);

			expect(result).toMatchObject(match);
			expect(result?.activeSession).toBeNull();
		});
	});

	describe('findByEventId', () => {
		it('returns all matches for event', async () => {
			const matches = [createMockFeatureMatch(), createMockFeatureMatch({ id: 2 })];
			mockDb.query.featureMatches.findMany.mockResolvedValue(matches.map(match => ({ ...match, activeSession: null })));

			const result = await featureMatchService().findByEventId(1);

			expect(result).toEqual(matches.map(match => ({ ...match, activeSession: null })));
			expect(mockDb.query.featureMatches.findMany).toHaveBeenCalledOnce();
			expect(mockDb.query.featureMatchSessions.findFirst).not.toHaveBeenCalled();
		});

		it('returns empty array when no matches', async () => {
			mockDb.query.featureMatches.findMany.mockResolvedValue([]);

			const result = await featureMatchService().findByEventId(1);

			expect(result).toEqual([]);
		});
	});

	describe('create', () => {
		it('creates match with event default bestOf', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ featureMatchDefaultBestOf: 5 });
			const newMatch = createMockFeatureMatch({ id: 10, bestOf: 5, sortOrder: 3 });
			getChain('insert').returning.mockResolvedValue([newMatch]);
			// findById after create
			mockDb.query.featureMatches.findFirst.mockResolvedValue(newMatch);

			const result = await featureMatchService().create(1, {} as any);

			expect(result).toMatchObject(newMatch);
			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: null,
				externalSource: 'manual',
			}));
		});

		it('strips forged Melee provenance and session pointer before inserting', async () => {
			const newMatch = createMockFeatureMatch({ bestOf: 3, sortOrder: 0 });
			getChain('insert').returning.mockResolvedValue([newMatch]);
			mockDb.query.featureMatches.findFirst.mockResolvedValue(newMatch);

			await featureMatchService().create(1, {
				bestOf: 3,
				externalId: 'forged-id',
				externalSource: 'melee',
				activeSessionId: 42,
			} as any);

			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: null,
				externalSource: 'manual',
			}));
			expect(getChain('insert').values).not.toHaveBeenCalledWith(expect.objectContaining({
				activeSessionId: 42,
			}));
		});

		it('uses provided bestOf over event default', async () => {
			const newMatch = createMockFeatureMatch({ bestOf: 1, sortOrder: 0 });
			getChain('insert').returning.mockResolvedValue([newMatch]);
			mockDb.query.featureMatches.findFirst.mockResolvedValue(newMatch);

			const result = await featureMatchService().create(1, { bestOf: 1 } as any);

			expect(result).toMatchObject(newMatch);
		});

		it('derives slot provenance from a referenced event Match', async () => {
			const newMatch = createMockFeatureMatch({
				matchId: 22,
				externalId: 'match-22',
				externalSource: 'melee',
			});
			mockDb.query.matches.findFirst.mockResolvedValue({
				externalId: 'match-22',
				externalSource: 'melee',
			});
			getChain('insert').returning.mockResolvedValue([newMatch]);
			mockDb.query.featureMatches.findFirst.mockResolvedValue(newMatch);

			await featureMatchService().create(1, {
				matchId: 22,
				// Prove the service boundary overwrites forged values even if a
				// non-HTTP caller bypasses the public schema.
				externalId: 'forged',
				externalSource: 'manual',
			} as any);

			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				matchId: 22,
				externalId: 'match-22',
				externalSource: 'melee',
			}));
		});

		it('removes an unusable slot when initial session creation fails', async () => {
			const newMatch = createMockFeatureMatch({ id: 10 });
			getChain('insert').returning.mockResolvedValue([newMatch]);
			featureMatchStateServiceMocks.createSessionForSlot.mockRejectedValueOnce(new Error('session failed'));

			await expect(featureMatchService().create(1, {} as any)).rejects.toThrow('session failed');

			expect(mockDb.delete).toHaveBeenCalledOnce();
		});

		it('surfaces the session failure when the compensating delete also fails, attaching the delete failure', async () => {
			const newMatch = createMockFeatureMatch({ id: 10 });
			getChain('insert').returning.mockResolvedValue([newMatch]);
			const sessionFailure = new Error('session failed');
			featureMatchStateServiceMocks.createSessionForSlot.mockRejectedValueOnce(sessionFailure);
			const deleteFailure = new Error('delete failed');
			getChain('delete').where.mockRejectedValueOnce(deleteFailure);

			await expect(featureMatchService().create(1, {} as any)).rejects.toBe(sessionFailure);

			expect((sessionFailure as { compensationFailure?: unknown }).compensationFailure).toBe(deleteFailure);
		});
	});

	describe('update', () => {
		it('returns updated match', async () => {
			const updated = createMockFeatureMatch({ player1Id: 5 });
			mockDb.query.featureMatches.findFirst.mockResolvedValue(updated);
			getChain('update').returning.mockResolvedValue([updated]);

			const result = await featureMatchService().update(1, 1, { player1Id: 5 } as any);

			expect(result).toMatchObject(updated);
		});

		it('strips forged Melee provenance and session pointer before writing', async () => {
			const current = createMockFeatureMatch({ roundName: 'Quarters' });
			mockDb.query.featureMatches.findFirst.mockResolvedValue(current);
			getChain('update').returning.mockResolvedValue([current]);

			await featureMatchService().update(1, 1, {
				roundName: 'Finals',
				externalId: 'forged-id',
				externalSource: 'melee',
				activeSessionId: 42,
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith({ roundName: 'Finals' });
		});
	});

	describe('remove', () => {
		it('returns true when deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockFeatureMatch()]);

			const result = await featureMatchService().remove(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await featureMatchService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('exists', () => {
		it('returns true when match exists', async () => {
			mockDb.query.featureMatches.findFirst.mockResolvedValue({ id: 1 });

			const result = await featureMatchService().exists(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when not found', async () => {
			const result = await featureMatchService().exists(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('countByEventId', () => {
		it('returns count of matches', async () => {
			getChain('select').where.mockResolvedValue([{ count: 5 }]);

			const result = await featureMatchService().countByEventId(1);

			expect(result).toBe(5);
		});

		it('returns 0 when no matches', async () => {
			getChain('select').where.mockResolvedValue([{ count: 0 }]);

			const result = await featureMatchService().countByEventId(1);

			expect(result).toBe(0);
		});
	});

	describe('syncFeatureMatches', () => {
		it('creates matches when target > current', async () => {
			mockDb.query.featureMatches.findMany.mockResolvedValueOnce([]);
			const created = [createMockFeatureMatch({ id: 1 }), createMockFeatureMatch({ id: 2 })];
			getChain('insert').returning.mockResolvedValue(created);
			// Session creation for each created match uses update chain
			getChain('update').returning.mockResolvedValue([{ state: {}, stateVersion: 0 }]);

			const result = await featureMatchService().syncFeatureMatches(1, 2);

			expect(result.created).toHaveLength(2);
			expect(result.deleted).toHaveLength(0);
			expect(featureMatchStateServiceMocks.loadEventDefaults).toHaveBeenCalledWith(1);
			expect(featureMatchStateServiceMocks.createSessionForSlot).toHaveBeenNthCalledWith(
				1,
				1,
				1,
				expect.objectContaining({
					game: 'mtg',
					turnTrackingEnabled: false,
					extraTurnsEnabled: true,
					extraTurns: 5,
					mulliganTrackingEnabled: false,
				}),
			);
		});

		it('deletes matches when target < current', async () => {
			const existing = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 1 }),
				createMockFeatureMatch({ id: 3, sortOrder: 2 }),
			];
			mockDb.query.featureMatches.findMany.mockResolvedValueOnce(existing.map(match => ({ ...match, activeSession: null })));

			const result = await featureMatchService().syncFeatureMatches(1, 1);

			expect(result.created).toHaveLength(0);
			expect(result.deleted).toEqual([3, 2]);
		});

		it('surfaces the session failure when the compensating delete also fails, attaching the delete failure', async () => {
			mockDb.query.featureMatches.findMany.mockResolvedValueOnce([]);
			getChain('insert').returning.mockResolvedValue([createMockFeatureMatch({ id: 1 })]);
			const sessionFailure = new Error('session failed');
			featureMatchStateServiceMocks.createSessionForSlot.mockRejectedValueOnce(sessionFailure);
			const deleteFailure = new Error('delete failed');
			getChain('delete').where.mockRejectedValueOnce(deleteFailure);

			await expect(featureMatchService().syncFeatureMatches(1, 1)).rejects.toBe(sessionFailure);

			expect((sessionFailure as { compensationFailure?: unknown }).compensationFailure).toBe(deleteFailure);
		});

		it('returns empty arrays when target === current', async () => {
			mockDb.query.featureMatches.findMany.mockResolvedValueOnce([{ ...createMockFeatureMatch(), activeSession: null }]);

			const result = await featureMatchService().syncFeatureMatches(1, 1);

			expect(result.created).toHaveLength(0);
			expect(result.deleted).toHaveLength(0);
		});
	});

	describe('swapMatchOrder', () => {
		it('swaps two adjacent matches going up', async () => {
			const m1 = createMockFeatureMatch({ id: 1, sortOrder: 0 });
			const m2 = createMockFeatureMatch({ id: 2, sortOrder: 1 });
			mockDb.query.featureMatches.findMany.mockResolvedValueOnce([
				{ ...m1, activeSession: null },
				{ ...m2, activeSession: null },
			]);

			const result = await featureMatchService().swapMatchOrder(1, 2, 'up');

			expect(result).toEqual([
				{ matchId: 2, sortOrder: 0 },
				{ matchId: 1, sortOrder: 1 },
			]);
		});

		it('normalises any duplicate order before swapping', async () => {
			const duplicated = [
				createMockFeatureMatch({ id: 1, sortOrder: 0 }),
				createMockFeatureMatch({ id: 2, sortOrder: 0 }),
				createMockFeatureMatch({ id: 3, sortOrder: 1 }),
			];
			const normalised = duplicated.map((match, sortOrder) => ({
				...match,
				sortOrder,
				activeSession: null,
			}));
			mockDb.query.featureMatches.findMany
				.mockResolvedValueOnce(duplicated.map(match => ({ ...match, activeSession: null })))
				.mockResolvedValueOnce(normalised);

			const result = await featureMatchService().swapMatchOrder(1, 2, 'down');

			expect(result).toEqual([
				{ matchId: 2, sortOrder: 2 },
				{ matchId: 3, sortOrder: 1 },
			]);
			expect(mockDb.batch).toHaveBeenCalledTimes(2);
			expect(mockDb.batch.mock.calls[0]?.[0]).toHaveLength(3);
		});
	});
});
