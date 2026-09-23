import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockMatch } from '~~/test/helpers/fixtures';

vi.mock('~~/server/db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	matches: {
		id: 'matches.id',
		eventId: 'matches.eventId',
		roundId: 'matches.roundId',
		externalId: 'matches.externalId',
		externalSource: 'matches.externalSource',
		tableNumber: 'matches.tableNumber',
		player1Id: 'matches.player1Id',
		player2Id: 'matches.player2Id',
		player1Data: 'matches.player1Data',
		player2Data: 'matches.player2Data',
		sortOrder: 'matches.sortOrder',
	},
	featureMatches: {
		id: 'featureMatches.id',
		eventId: 'featureMatches.eventId',
		matchId: 'featureMatches.matchId',
		externalId: 'featureMatches.externalId',
		externalSource: 'featureMatches.externalSource',
		tableNumber: 'featureMatches.tableNumber',
		roundName: 'featureMatches.roundName',
		formatName: 'featureMatches.formatName',
		player1Id: 'featureMatches.player1Id',
		player2Id: 'featureMatches.player2Id',
		player1Data: 'featureMatches.player1Data',
		player2Data: 'featureMatches.player2Data',
	},
	rounds: {
		id: 'rounds.id',
		eventId: 'rounds.eventId',
		phaseId: 'rounds.phaseId',
		name: 'rounds.name',
	},
}));

// createError is auto-imported in Nitro
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	return err;
});

const { buildMatchPromotionPlan, matchService } = await import('~~/server/services/match');

describe('matchService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findById', () => {
		it('returns match when found', async () => {
			const match = createMockMatch();
			mockDb.query.matches.findFirst.mockResolvedValue(match);

			const result = await matchService().findById(1, 1);

			expect(result).toEqual(match);
			expect(mockDb.query.matches.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('findByEventId', () => {
		it('returns matches ordered by sortOrder and id', async () => {
			const matches = [
				createMockMatch({ id: 1, sortOrder: 0 }),
				createMockMatch({ id: 2, sortOrder: 1 }),
			];
			getChain('select').orderBy.mockResolvedValue(matches);

			const result = await matchService().findByEventId(1);

			expect(result).toEqual(matches);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no matches exist', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await matchService().findByEventId(1);

			expect(result).toEqual([]);
		});
	});

	describe('findByRoundId', () => {
		it('returns matches for a specific round', async () => {
			const matches = [createMockMatch({ roundId: 5 })];
			getChain('select').orderBy.mockResolvedValue(matches);

			const result = await matchService().findByRoundId(1, 5);

			expect(result).toEqual(matches);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no matches in round', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await matchService().findByRoundId(1, 999);

			expect(result).toEqual([]);
		});
	});

	describe('create', () => {
		it('returns newly created match with auto sort order', async () => {
			const newMatch = createMockMatch({ sortOrder: 3 });
			// First select chain: getMaxSortOrder query
			getChain('select').where.mockResolvedValue([{ max: 2 }]);
			// After resetDbMocks, we need a fresh insert chain — but the same chain is reused
			getChain('insert').returning.mockResolvedValue([newMatch]);

			const result = await matchService().create(1, { roundId: 1 } as any);

			expect(result).toEqual(newMatch);
			expect(mockDb.insert).toHaveBeenCalledOnce();
			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: null,
				externalSource: 'manual',
			}));
		});

		it('uses provided sortOrder when specified', async () => {
			const newMatch = createMockMatch({ sortOrder: 10 });
			getChain('select').where.mockResolvedValue([{ max: 5 }]);
			getChain('insert').returning.mockResolvedValue([newMatch]);

			const result = await matchService().create(1, { roundId: 1, sortOrder: 10 } as any);

			expect(result).toEqual(newMatch);
		});

		it('defaults max sort order to -1 when no matches exist', async () => {
			const newMatch = createMockMatch({ sortOrder: 0 });
			getChain('select').where.mockResolvedValue([{ max: -1 }]);
			getChain('insert').returning.mockResolvedValue([newMatch]);

			const result = await matchService().create(1, { roundId: 1 } as any);

			expect(result).toEqual(newMatch);
		});

		it('handles null result from getMaxSortOrder', async () => {
			const newMatch = createMockMatch({ sortOrder: 0 });
			getChain('select').where.mockResolvedValue([]);
			getChain('insert').returning.mockResolvedValue([newMatch]);

			const result = await matchService().create(1, { roundId: 1 } as any);

			expect(result).toEqual(newMatch);
		});

		it('strips unclassified and server-managed keys before inserting', async () => {
			getChain('select').where.mockResolvedValue([{ max: 2 }]);
			getChain('insert').returning.mockResolvedValue([createMockMatch()]);

			await matchService().create(1, {
				roundId: 1,
				id: 99,
				createdAt: new Date(0),
			} as any);

			expect(getChain('insert').values).not.toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
		});
	});

	describe('update', () => {
		it('returns updated match', async () => {
			const updatedMatch = createMockMatch({ tableNumber: 5 });
			getChain('update').returning.mockResolvedValue([updatedMatch]);

			const result = await matchService().update(1, 1, { tableNumber: 5 } as any);

			expect(result).toEqual(updatedMatch);
			expect(mockDb.update).toHaveBeenCalledOnce();
		});

		it('strips forged Melee provenance before writing', async () => {
			getChain('update').returning.mockResolvedValue([createMockMatch()]);

			await matchService().update(1, 1, {
				tableNumber: 9,
				externalId: 'forged-id',
				externalSource: 'melee',
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith({ tableNumber: 9 });
		});
	});

	describe('remove', () => {
		it('returns true when match deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockMatch()]);

			const result = await matchService().remove(1, 1);

			expect(result).toBe(true);
			expect(mockDb.delete).toHaveBeenCalledOnce();
		});

		it('returns false when match not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await matchService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('exists', () => {
		it('returns true when match exists', async () => {
			mockDb.query.matches.findFirst.mockResolvedValue({ id: 1 });

			const result = await matchService().exists(1, 1);

			expect(result).toBe(true);
			expect(mockDb.query.matches.findFirst).toHaveBeenCalledOnce();
		});

		it('returns false when match does not exist', async () => {
			mockDb.query.matches.findFirst.mockResolvedValue(undefined);

			const result = await matchService().exists(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('buildMatchPromotionPlan', () => {
		const match = createMockMatch({
			id: 5,
			externalId: 'ext-1',
			externalSource: 'melee',
			tableNumber: 3,
			player1Id: 10,
			player2Id: 20,
			player1Data: { name: 'Player 1' } as any,
			player2Data: { name: 'Player 2' } as any,
		});
		const targetSlot = { id: 2, eventId: 1 } as any;

		it('builds only the promote statement when there are no duplicate slots', async () => {
			mockDb.query.rounds.findFirst.mockResolvedValue({ id: 1, eventId: 1, phaseId: 9, name: 'Round 4' });
			getChain('select').where.mockResolvedValue([]);

			const plan = await buildMatchPromotionPlan(1, 2, match, targetSlot);

			expect(plan.clearedSlots).toEqual([]);
			expect(plan.queries).toHaveLength(1);
			expect(plan.promotedSlot).toMatchObject({ id: 2, matchId: 5, roundName: 'Round 4' });
			expect(getChain('update').set).toHaveBeenLastCalledWith({
				matchId: 5,
				externalId: 'ext-1',
				externalSource: 'melee',
				tableNumber: 3,
				roundName: 'Round 4',
				formatName: null,
				player1Id: 10,
				player2Id: 20,
				player1Data: { name: 'Player 1' },
				player2Data: { name: 'Player 2' },
				updatedAt: expect.any(Date),
			});
		});

		it('adds a scoped clear statement and cleared-slot rows for each duplicate', async () => {
			mockDb.query.rounds.findFirst.mockResolvedValue({ id: 1, eventId: 1, phaseId: 9, name: 'Round 4' });
			getChain('select').where.mockResolvedValue([{ id: 8, eventId: 1, matchId: 5, player1Data: { name: 'Stale' } }]);

			const plan = await buildMatchPromotionPlan(1, 2, match, targetSlot);

			// Clear statement first, then promote statement.
			expect(plan.queries).toHaveLength(2);
			expect(plan.clearedSlots).toEqual([
				expect.objectContaining({ id: 8, matchId: null, player1Data: null, player2Data: null }),
			]);
		});
	});
});
