import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockArchetype } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	archetypes: {
		id: 'archetypes.id',
		eventId: 'archetypes.eventId',
		name: 'archetypes.name',
		colors: 'archetypes.colors',
	},
}));

const { archetypeService } = await import('~~/server/services/archetype');

describe('archetypeService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findByEventId', () => {
		it('returns archetypes for an event', async () => {
			const archetypes = [
				createMockArchetype({ id: 1, name: 'Azorius Control' }),
				createMockArchetype({ id: 2, name: 'Boros Aggro' }),
			];
			getChain('select').orderBy.mockResolvedValue(archetypes);

			const result = await archetypeService().findByEventId(1);

			expect(result).toEqual(archetypes);
		});

		it('returns empty array when no archetypes exist', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await archetypeService().findByEventId(99);

			expect(result).toEqual([]);
		});
	});

	describe('findById', () => {
		it('returns archetype when found', async () => {
			const archetype = createMockArchetype();
			getChain('select').limit.mockResolvedValue([archetype]);

			const result = await archetypeService().findById(1, 1);

			expect(result).toEqual(archetype);
		});
	});

	describe('findManyByIds', () => {
		it('deduplicates IDs and scopes the lookup to the event', async () => {
			const rows = [createMockArchetype({ id: 1 }), createMockArchetype({ id: 2 })];
			getChain('select').where.mockResolvedValue(rows);

			await expect(archetypeService().findManyByIds(3, [1, 2, 1])).resolves.toEqual(rows);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});
	});

	describe('create', () => {
		it('creates a new archetype', async () => {
			const created = createMockArchetype({ id: 5, name: 'Golgari Midrange', colors: 'BG' });
			getChain('insert').returning.mockResolvedValue([created]);

			const result = await archetypeService().create(1, {
				name: 'Golgari Midrange',
				colors: 'BG',
			});

			expect(result).toEqual(created);
			expect(mockDb.insert).toHaveBeenCalled();
		});

		it('creates archetype with null colors', async () => {
			const created = createMockArchetype({
				id: 6,
				name: 'Azorius Control',
				colors: null,
			});
			getChain('insert').returning.mockResolvedValue([created]);

			const result = await archetypeService().create(1, {
				name: 'Azorius Control',
				colors: null,
			});

			expect(result.colors).toBeNull();
		});
	});

	describe('update', () => {
		it('updates archetype and returns it (no cascade)', async () => {
			const updated = createMockArchetype({ id: 1, colors: 'WUB' });
			getChain('update').returning.mockResolvedValue([updated]);

			const result = await archetypeService().update(1, 1, { colors: 'WUB' });

			expect(result?.colors).toBe('WUB');
		});
	});

	describe('remove', () => {
		it('returns false when archetype not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await archetypeService().remove(999, 1);

			expect(result).toBe(false);
		});

		it('deletes archetype and returns true (no cascade)', async () => {
			const archetype = createMockArchetype({ id: 1 });
			getChain('delete').returning.mockResolvedValue([archetype]);

			const result = await archetypeService().remove(1, 1);

			expect(result).toBe(true);
		});
	});
});
