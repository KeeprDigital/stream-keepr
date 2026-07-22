import { describe, expect, it } from 'vitest';
import { mapMatchToResponse } from '~~/server/mappers/match';
import { createMockMatch } from '~~/test/helpers/fixtures';

describe('match mapper', () => {
	describe('mapMatchToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const match = createMockMatch({
				createdAt: '2026-01-15T12:00:00.000Z' as unknown as Date,
				updatedAt: '2026-02-20T18:30:00.000Z' as unknown as Date,
			});
			const result = mapMatchToResponse(match);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-01-15T12:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-02-20T18:30:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-03-01T00:00:00.000Z');
			const updated = new Date('2026-03-02T00:00:00.000Z');
			const match = createMockMatch({ createdAt: created, updatedAt: updated });
			const result = mapMatchToResponse(match);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('passes through all fields', () => {
			const match = createMockMatch({
				id: 42,
				eventId: 7,
				roundId: 3,
				tableNumber: 5,
				sortOrder: 2,
			});
			const result = mapMatchToResponse(match);

			expect(result.id).toBe(42);
			expect(result.eventId).toBe(7);
			expect(result.roundId).toBe(3);
			expect(result.tableNumber).toBe(5);
			expect(result.sortOrder).toBe(2);
		});
	});
});
