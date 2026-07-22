import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockTalent } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	eventTalents: {
		id: 'eventTalents.id',
		eventId: 'eventTalents.eventId',
	},
}));

const { talentService } = await import('~~/server/services/talent');

describe('talentService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findById', () => {
		it('returns talent when found', async () => {
			const talent = createMockTalent();
			mockDb.query.eventTalents.findFirst.mockResolvedValue(talent);

			const result = await talentService().findById(1, 1);

			expect(result).toEqual(talent);
			expect(mockDb.query.eventTalents.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('findByEventId', () => {
		it('returns all talents for event', async () => {
			const talents = [createMockTalent(), createMockTalent({ id: 2, name: 'Talent 2' })];
			getChain('select').where.mockResolvedValue(talents);

			const result = await talentService().findByEventId(1);

			expect(result).toEqual(talents);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no talents', async () => {
			getChain('select').where.mockResolvedValue([]);

			const result = await talentService().findByEventId(1);

			expect(result).toEqual([]);
		});
	});

	describe('create', () => {
		it('returns created talent', async () => {
			const newTalent = createMockTalent({ name: 'New Caster' });
			getChain('insert').returning.mockResolvedValue([newTalent]);

			const result = await talentService().create(1, { name: 'New Caster' });

			expect(result).toEqual(newTalent);
		});
	});

	describe('update', () => {
		it('returns updated talent', async () => {
			const updated = createMockTalent({ name: 'Updated' });
			getChain('update').returning.mockResolvedValue([updated]);

			const result = await talentService().update(1, 1, { name: 'Updated' });

			expect(result).toEqual(updated);
		});
	});

	describe('remove', () => {
		it('returns true when deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockTalent()]);

			const result = await talentService().remove(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await talentService().remove(999, 1);

			expect(result).toBe(false);
		});
	});
});
