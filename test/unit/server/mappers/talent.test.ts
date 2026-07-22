import { describe, expect, it } from 'vitest';
import { mapTalentToResponse } from '~~/server/mappers/talent';
import { createMockTalent } from '~~/test/helpers/fixtures';

describe('talent mapper', () => {
	describe('mapTalentToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const talent = createMockTalent({
				createdAt: '2026-09-01T15:00:00.000Z' as unknown as Date,
				updatedAt: '2026-09-01T16:00:00.000Z' as unknown as Date,
			});
			const result = mapTalentToResponse(talent);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-09-01T15:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-09-01T16:00:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-01-01T00:00:00.000Z');
			const updated = new Date('2026-01-02T00:00:00.000Z');
			const talent = createMockTalent({ createdAt: created, updatedAt: updated });
			const result = mapTalentToResponse(talent);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all talent fields in the response', () => {
			const talent = createMockTalent({
				id: 5,
				eventId: 2,
				name: 'Marshall Sutcliffe',
			});
			const result = mapTalentToResponse(talent);

			expect(result.id).toBe(5);
			expect(result.eventId).toBe(2);
			expect(result.name).toBe('Marshall Sutcliffe');
		});
	});
});
