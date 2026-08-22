import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockRound } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	rounds: {
		id: 'rounds.id',
		eventId: 'rounds.eventId',
		externalId: 'rounds.externalId',
		externalSource: 'rounds.externalSource',
		roundNumber: 'rounds.roundNumber',
		name: 'rounds.name',
		phaseName: 'rounds.phaseName',
		phaseId: 'rounds.phaseId',
	},
	phases: {
		id: 'phases.id',
		sortOrder: 'phases.sortOrder',
	},
}));

const { roundService } = await import('~~/server/services/round');

describe('roundService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findById', () => {
		it('returns round when found', async () => {
			const round = createMockRound();
			mockDb.query.rounds.findFirst.mockResolvedValue(round);

			const result = await roundService().findById(1, 1);

			expect(result).toEqual(round);
			expect(mockDb.query.rounds.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('findByEventId', () => {
		it('returns rounds ordered by roundNumber and id', async () => {
			const rounds = [
				createMockRound({ id: 1, roundNumber: 1 }),
				createMockRound({ id: 2, roundNumber: 2, name: 'Round 2' }),
			];
			getChain('select').orderBy.mockResolvedValue(rounds);

			const result = await roundService().findByEventId(1);

			expect(result).toEqual(rounds);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no rounds exist', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await roundService().findByEventId(1);

			expect(result).toEqual([]);
		});
	});

	describe('create', () => {
		it('returns newly created round', async () => {
			const newRound = createMockRound();
			getChain('insert').returning.mockResolvedValue([newRound]);

			const result = await roundService().create(1, { name: 'Round 1', roundNumber: 1 } as any);

			expect(result).toEqual(newRound);
			expect(mockDb.insert).toHaveBeenCalledOnce();
			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: null,
				externalSource: 'manual',
				lastSyncedAt: null,
			}));
		});

		it('strips unclassified and server-managed keys before inserting', async () => {
			getChain('insert').returning.mockResolvedValue([createMockRound()]);

			await roundService().create(1, {
				name: 'Round 1',
				roundNumber: 1,
				id: 99,
				createdAt: new Date(0),
			} as any);

			expect(getChain('insert').values).not.toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
		});
	});

	describe('update', () => {
		it('returns updated round', async () => {
			const updatedRound = createMockRound({ name: 'Updated Round' });
			getChain('update').returning.mockResolvedValue([updatedRound]);

			const result = await roundService().update(1, 1, { name: 'Updated Round' } as any);

			expect(result).toEqual(updatedRound);
			expect(mockDb.update).toHaveBeenCalledOnce();
		});

		it('strips forged Melee provenance before writing', async () => {
			getChain('update').returning.mockResolvedValue([createMockRound()]);

			await roundService().update(1, 1, {
				name: 'Forged Round',
				externalId: 'forged-id',
				externalSource: 'melee',
				lastSyncedAt: new Date(0),
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith({ name: 'Forged Round' });
		});
	});

	describe('remove', () => {
		it('returns true when round deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockRound()]);

			const result = await roundService().remove(1, 1);

			expect(result).toBe(true);
			expect(mockDb.delete).toHaveBeenCalledOnce();
		});

		it('returns false when round not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await roundService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('findByExternalId', () => {
		it('returns round when found by external id', async () => {
			const round = createMockRound({ externalId: 'ext-1', externalSource: 'melee' });
			mockDb.query.rounds.findFirst.mockResolvedValue(round);

			const result = await roundService().findByExternalId(1, 'ext-1', 'melee');

			expect(result).toEqual(round);
			expect(mockDb.query.rounds.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('exists', () => {
		it('returns true when round exists', async () => {
			mockDb.query.rounds.findFirst.mockResolvedValue({ id: 1 });

			const result = await roundService().exists(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when round does not exist', async () => {
			mockDb.query.rounds.findFirst.mockResolvedValue(undefined);

			const result = await roundService().exists(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('findByPhaseId', () => {
		it('returns rounds for a specific phase', async () => {
			const rounds = [
				createMockRound({ id: 1, phaseId: 2, roundNumber: 1 }),
				createMockRound({ id: 2, phaseId: 2, roundNumber: 2, name: 'Round 2' }),
			];
			getChain('select').orderBy.mockResolvedValue(rounds);

			const result = await roundService().findByPhaseId(2, 1);

			expect(result).toEqual(rounds);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no rounds in phase', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await roundService().findByPhaseId(999, 1);

			expect(result).toEqual([]);
		});
	});

	describe('upsertByExternalId', () => {
		it('returns created=true when timestamps match (new insert)', async () => {
			const now = new Date('2026-03-25T12:00:00.000Z');
			const upsertedRound = createMockRound({
				externalId: 'ext-1',
				externalSource: 'melee',
				createdAt: now,
				updatedAt: now,
			});
			getChain('insert').returning.mockResolvedValue([upsertedRound]);

			const result = await roundService().upsertByExternalId({
				eventId: 1,
				name: 'Round 1',
				roundNumber: 1,
				externalId: 'ext-1',
				externalSource: 'melee',
			} as any);

			expect(result.created).toBe(true);
			expect(result.round).toEqual(upsertedRound);
			expect(getChain('insert').onConflictDoUpdate).toHaveBeenCalledOnce();
			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: 'ext-1',
				externalSource: 'melee',
			}));
		});

		it('returns created=false when timestamps differ (conflict update)', async () => {
			const upsertedRound = createMockRound({
				externalId: 'ext-1',
				externalSource: 'melee',
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-03-25T12:00:00.000Z'),
			});
			getChain('insert').returning.mockResolvedValue([upsertedRound]);

			const result = await roundService().upsertByExternalId({
				eventId: 1,
				name: 'Round 1',
				roundNumber: 1,
				externalId: 'ext-1',
				externalSource: 'melee',
			} as any);

			expect(result.created).toBe(false);
			expect(result.round).toEqual(upsertedRound);
		});
	});
});
