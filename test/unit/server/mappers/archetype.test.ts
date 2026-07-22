import { describe, expect, it } from 'vitest';
import { mapArchetypeToResponse } from '~~/server/mappers/archetype';
import { createMockArchetype } from '~~/test/helpers/fixtures';

describe('archetype mapper', () => {
	describe('mapArchetypeToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const archetype = createMockArchetype({
				createdAt: '2026-04-15T12:00:00.000Z' as unknown as Date,
				updatedAt: '2026-04-15T13:00:00.000Z' as unknown as Date,
			});
			const result = mapArchetypeToResponse(archetype);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-04-15T12:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-04-15T13:00:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-01-01T00:00:00.000Z');
			const updated = new Date('2026-01-02T00:00:00.000Z');
			const archetype = createMockArchetype({ createdAt: created, updatedAt: updated });
			const result = mapArchetypeToResponse(archetype);

			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all archetype fields in the response', () => {
			const archetype = createMockArchetype({
				id: 42,
				eventId: 3,
				name: 'Azorius Control',
				colors: 'WU',
			});
			const result = mapArchetypeToResponse(archetype);

			expect(result.id).toBe(42);
			expect(result.eventId).toBe(3);
			expect(result.name).toBe('Azorius Control');
			expect(result.colors).toBe('WU');
		});

		it('preserves null optional fields', () => {
			const archetype = createMockArchetype({ colors: null });
			const result = mapArchetypeToResponse(archetype);

			expect(result.colors).toBeNull();
		});
	});
});
