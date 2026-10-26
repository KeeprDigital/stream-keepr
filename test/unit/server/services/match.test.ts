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
}));

// createError is auto-imported in Nitro
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	return err;
});

const { matchService } = await import('~~/server/services/match');

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
			const matches = [
				createMockMatch({ roundId: 5 }),
			];
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
			getChain('select').where.mockResolvedValue([
				{ max: 2 },
			]);
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
			getChain('select').where.mockResolvedValue([
				{ max: 5 },
			]);
			getChain('insert').returning.mockResolvedValue([newMatch]);

			const result = await matchService().create(1, { roundId: 1, sortOrder: 10 } as any);

			expect(result).toEqual(newMatch);
		});

		it('defaults max sort order to -1 when no matches exist', async () => {
			const newMatch = createMockMatch({ sortOrder: 0 });
			getChain('select').where.mockResolvedValue([
				{ max: -1 },
			]);
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
			getChain('select').where.mockResolvedValue([
				{ max: 2 },
			]);
			getChain('insert').returning.mockResolvedValue([
				createMockMatch(),
			]);

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
			getChain('update').returning.mockResolvedValue([
				createMockMatch(),
			]);

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
			getChain('delete').returning.mockResolvedValue([
				createMockMatch(),
			]);

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
});
