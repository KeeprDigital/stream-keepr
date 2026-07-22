import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockPhase } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	phases: {
		id: 'phases.id',
		eventId: 'phases.eventId',
		sortOrder: 'phases.sortOrder',
		externalId: 'phases.externalId',
		externalSource: 'phases.externalSource',
	},
}));

const { phaseService } = await import('~~/server/services/phase');

describe('phaseService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findById', () => {
		it('returns phase when found', async () => {
			const phase = createMockPhase();
			mockDb.query.phases.findFirst.mockResolvedValue(phase);

			const result = await phaseService().findById(1, 1);

			expect(result).toEqual(phase);
			expect(mockDb.query.phases.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('findByEventId', () => {
		it('returns phases ordered by sortOrder and id', async () => {
			const phases = [
				createMockPhase({ id: 1, sortOrder: 0 }),
				createMockPhase({ id: 2, sortOrder: 1, name: 'Top 8' }),
			];
			getChain('select').orderBy.mockResolvedValue(phases);

			const result = await phaseService().findByEventId(1);

			expect(result).toEqual(phases);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no phases exist', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await phaseService().findByEventId(1);

			expect(result).toEqual([]);
		});
	});

	describe('create', () => {
		it('returns newly created phase', async () => {
			const newPhase = createMockPhase();
			getChain('insert').returning.mockResolvedValue([newPhase]);

			const result = await phaseService().create(1, { name: 'Swiss' } as any);

			expect(result).toEqual(newPhase);
			expect(mockDb.insert).toHaveBeenCalledOnce();
			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: null,
				externalSource: 'manual',
				formatExternalId: null,
			}));
		});

		it('strips unclassified and server-managed keys before inserting', async () => {
			getChain('insert').returning.mockResolvedValue([createMockPhase()]);

			await phaseService().create(1, {
				name: 'Swiss',
				id: 99,
				createdAt: new Date(0),
			} as any);

			expect(getChain('insert').values).not.toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
		});
	});

	describe('update', () => {
		it('returns updated phase', async () => {
			const updatedPhase = createMockPhase({ name: 'Top 8' });
			getChain('update').returning.mockResolvedValue([updatedPhase]);

			const result = await phaseService().update(1, 1, { name: 'Top 8' } as any);

			expect(result).toEqual(updatedPhase);
			expect(mockDb.update).toHaveBeenCalledOnce();
		});

		it('strips forged Melee provenance before writing', async () => {
			getChain('update').returning.mockResolvedValue([createMockPhase()]);

			await phaseService().update(1, 1, {
				name: 'Forged Phase',
				externalId: 'forged-id',
				externalSource: 'melee',
				formatExternalId: 'forged-format',
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith({ name: 'Forged Phase' });
		});
	});

	describe('remove', () => {
		it('returns true when phase deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockPhase()]);

			const result = await phaseService().remove(1, 1);

			expect(result).toBe(true);
			expect(mockDb.delete).toHaveBeenCalledOnce();
		});

		it('returns false when phase not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await phaseService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('exists', () => {
		it('returns true when phase exists', async () => {
			mockDb.query.phases.findFirst.mockResolvedValue({ id: 1 });

			const result = await phaseService().exists(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when phase does not exist', async () => {
			mockDb.query.phases.findFirst.mockResolvedValue(undefined);

			const result = await phaseService().exists(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('getMaxSortOrder', () => {
		it('returns max sort order for event', async () => {
			getChain('select').where.mockResolvedValue([{ max: 3 }]);

			const result = await phaseService().getMaxSortOrder(1);

			expect(result).toBe(3);
		});

		it('returns -1 when no phases exist', async () => {
			getChain('select').where.mockResolvedValue([{ max: -1 }]);

			const result = await phaseService().getMaxSortOrder(1);

			expect(result).toBe(-1);
		});

		it('returns -1 when result is undefined', async () => {
			getChain('select').where.mockResolvedValue([undefined]);

			const result = await phaseService().getMaxSortOrder(1);

			expect(result).toBe(-1);
		});
	});

	describe('findByExternalId', () => {
		it('returns phase when found by external id', async () => {
			const phase = createMockPhase({ externalId: 'ext-1', externalSource: 'melee' });
			mockDb.query.phases.findFirst.mockResolvedValue(phase);

			const result = await phaseService().findByExternalId(1, 'ext-1', 'melee');

			expect(result).toEqual(phase);
			expect(mockDb.query.phases.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('upsertByExternalId', () => {
		it('returns created=true when timestamps match (new insert)', async () => {
			const now = new Date('2026-03-25T12:00:00.000Z');
			const upsertedPhase = createMockPhase({
				externalId: 'ext-1',
				externalSource: 'melee',
				createdAt: now,
				updatedAt: now,
			});
			getChain('insert').returning.mockResolvedValue([upsertedPhase]);

			const result = await phaseService().upsertByExternalId({
				eventId: 1,
				name: 'Swiss',
				externalId: 'ext-1',
				externalSource: 'melee',
			} as any);

			expect(result.created).toBe(true);
			expect(result.phase).toEqual(upsertedPhase);
			expect(getChain('insert').onConflictDoUpdate).toHaveBeenCalledOnce();
			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				externalId: 'ext-1',
				externalSource: 'melee',
			}));
		});

		it('returns created=false when timestamps differ (conflict update)', async () => {
			const upsertedPhase = createMockPhase({
				externalId: 'ext-1',
				externalSource: 'melee',
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-03-25T12:00:00.000Z'),
			});
			getChain('insert').returning.mockResolvedValue([upsertedPhase]);

			const result = await phaseService().upsertByExternalId({
				eventId: 1,
				name: 'Swiss',
				externalId: 'ext-1',
				externalSource: 'melee',
			} as any);

			expect(result.created).toBe(false);
			expect(result.phase).toEqual(upsertedPhase);
		});
	});
});
